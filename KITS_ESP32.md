# Kits ESP32: alta y uso

Cada kit contiene **un Gateway y tres nodos ESP32**. Los cuatro ejecutan el mismo código fuente del proyecto; cada kit lleva una configuración de fabricación con MAC y claves únicas. El rol del usuario cambia la interfaz y las facultades de aprobación, no el firmware que recibe.

## Preparación de un kit nuevo

El responsable de fabricar el kit crea un manifiesto JSON privado, por ejemplo:

```json
{
  "gatewayId": "gateway-2026-002",
  "gatewayMac": "AA:BB:CC:00:00:01",
  "claimCode": "CODIGO-ALEATORIO-UNICO-DEL-KIT",
  "pmk": "00112233445566778899aabbccddeeff",
  "wifiSsid": "RED_DEL_GATEWAY",
  "wifiPassword": "CLAVE_DE_LA_RED",
  "upstreamUrl": "https://servidor.example/api/gateway/sync",
  "nodes": [
    { "deviceId": "esp32-kit002-1", "macAddress": "AA:BB:CC:00:00:11", "hmacKey": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "lmk": "00112233445566778899aabbccddeeff" },
    { "deviceId": "esp32-kit002-2", "macAddress": "AA:BB:CC:00:00:12", "hmacKey": "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210", "lmk": "102132435465768798a9bacbdcedfe0f" },
    { "deviceId": "esp32-kit002-3", "macAddress": "AA:BB:CC:00:00:13", "hmacKey": "89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567", "lmk": "2031425364758697a8b9cadbecfd0e1f" }
  ]
}
```

Los valores mostrados son **solo un ejemplo de formato**. Leer las MAC físicas de las cuatro placas y generar PMK, HMAC, LMK y código de reclamo nuevos con un generador criptográfico seguro. El manifiesto y el C generado contienen secretos: guardarlos fuera de Git. El puerto COM se usa para grabar, nunca como identificador del kit.

Desde la raíz del proyecto:

```powershell
$env:DB_PATH = 'ruta/a/la/base-de-datos.sqlite'
node backend/scripts/import-kit.js 'ruta/privada/kit.json'
node firmware/esp32_node_idf/generate_kit_config.js 'ruta/privada/kit.json' 'ruta/privada/config_kit.c'
cd firmware/esp32_node_idf
./build_profiles.ps1 -Profile all -KitId kit002 -KitConfig 'ruta/privada/config_kit.c' -EnableBle
```

Grabar cada perfil (`gateway`, `node1`, `node2`, `node3`) en la placa cuya MAC coincide con el manifiesto. El código de reclamo se entrega con ese kit al usuario. La configuración original de las cuatro placas de prueba sigue en `main/config.c` y se usa cuando no se pasa `-KitConfig`.

## Flujo en la aplicación

1. Toda persona registra una cuenta. Quien elige modo avanzado debe aceptar la advertencia antes de recibir el rol Experimentado.
2. En **Mis dispositivos**, introduce el código del kit. Un código usado por otra cuenta no puede reclamarse de nuevo.
3. Pulsa **Buscar Dispositivos**. El Gateway informa únicamente MAC de sus tres peers preconfigurados. Por Wi-Fi, las informa después de verificar la trama ESP-NOW. Con `-EnableBle`, los nodos también anuncian su MAC Wi-Fi mediante BLE y el Gateway la compara con su inventario antes de informarla. BLE se usa aquí para descubrimiento; los datos operativos siguen viajando por ESP-NOW.
4. El usuario básico selecciona un nodo y envía la solicitud. El Experimentado la aprueba o rechaza desde **Mis dispositivos**. El registro manual avanzado también está limitado a los tres nodos inventariados.
5. Solo después de la aprobación el backend admite `POST /api/gateway/sync` para ese nodo. El primer latido autenticado lo muestra activo.

El escaneo abre una ventana de 45 segundos. El Gateway firma cada reporte de candidato con HMAC-SHA256 sobre `deviceId:MAC:transporte:nonce`, usando la clave del nodo preconfigurado. El backend compara ID y MAC con el inventario del kit y solo publica detecciones recientes. El anuncio BLE por sí solo no autoriza telemetría ni comandos.

## Límites de esta entrega

El Gateway del proyecto tiene tres peers ESP-NOW fijos por kit; la fabricación carga sus claves en cada imagen. No se incorpora un ESP32 arbitrario encontrado en el aire. BLE proporciona un segundo modo de **descubrir** los mismos tres nodos, no un transporte de telemetría BLE ni un emparejamiento GATT. Las cuatro placas existentes no se reflashean automáticamente; sus pruebas físicas previas siguen siendo la referencia. Antes de entregar kits con BLE habilitado, medir la coexistencia BLE/ESP-NOW en las placas físicas y confirmar que los heartbeats y rotaciones conservan la latencia esperada.
