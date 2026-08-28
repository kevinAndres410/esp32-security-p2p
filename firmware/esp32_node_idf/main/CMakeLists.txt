idf_component_register(
    SRCS "app_main.c" "config.c" "crypto.c" "protocol.c" "espnow_transport.c" "node.c" "gateway.c"
    INCLUDE_DIRS "."
    REQUIRES espressif__cjson esp_event esp_http_client esp_netif esp_wifi mbedtls nvs_flash
)
