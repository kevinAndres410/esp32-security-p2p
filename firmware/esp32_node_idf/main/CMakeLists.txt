set(KIT_CONFIG_C "" CACHE FILEPATH "Generated per-kit configuration C file")
if(KIT_CONFIG_C)
    set(CONFIG_SOURCE "${KIT_CONFIG_C}")
else()
    set(CONFIG_SOURCE "config.c")
endif()

idf_component_register(
    SRCS "app_main.c" "${CONFIG_SOURCE}" "crypto.c" "protocol.c" "espnow_transport.c" "node.c" "gateway.c" "ble_discovery.c"
    INCLUDE_DIRS "."
    REQUIRES espressif__cjson bt esp_event esp_http_client esp_netif esp_wifi mbedtls nvs_flash
)

set(FIRMWARE_PROFILE "gateway" CACHE STRING "Firmware profile: gateway, node1, node2 or node3")
set_property(CACHE FIRMWARE_PROFILE PROPERTY STRINGS gateway node1 node2 node3)

if(FIRMWARE_PROFILE STREQUAL "gateway")
    set(FIRMWARE_PROFILE_ID 0)
elseif(FIRMWARE_PROFILE STREQUAL "node1")
    set(FIRMWARE_PROFILE_ID 1)
elseif(FIRMWARE_PROFILE STREQUAL "node2")
    set(FIRMWARE_PROFILE_ID 2)
elseif(FIRMWARE_PROFILE STREQUAL "node3")
    set(FIRMWARE_PROFILE_ID 3)
else()
    message(FATAL_ERROR "Unknown FIRMWARE_PROFILE='${FIRMWARE_PROFILE}'")
endif()

target_compile_definitions(${COMPONENT_LIB} PRIVATE DEVICE_PROFILE=${FIRMWARE_PROFILE_ID})
