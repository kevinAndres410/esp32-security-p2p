# Firmware ESP-NOW gateway

Este proyecto ESP-IDF 6.1 se graba tanto en nodos como en el gateway. Hay cuatro
perfiles independientes: `gateway`, `node1`, `node2` y `node3`. Para compilar
todos use `./build_profiles.ps1`; también puede pasar `-Profile gateway`, por
ejemplo. Cada binario exportado queda en `artifacts/<perfil>`.

## Grabación sin puertos COM fijos

No se guarda ningún `COMx` en la configuración del proyecto. Windows puede
cambiar el número del puerto cuando se usa otro cable o conector USB. La placa
se identifica por su MAC física registrada, nunca por el número COM. Para
detectar la MAC, seleccionar automáticamente el perfil y grabarlo ejecute:

```powershell
./flash_profile.ps1
```

El script usa automáticamente el puerto si sólo hay uno. Si hay varias placas
conectadas, muestra los puertos detectados y solicita cuál quiere procesar. Después
lee su MAC con `esptool`, busca el perfil registrado y lo graba. También se puede
indicar el puerto sólo como transporte para esa ejecución, sin guardarlo:

```powershell
./flash_profile.ps1 -Port COM7
```

`-Profile node1` es opcional y funciona como una comprobación adicional: el
script sólo continúa si la MAC le pertenece realmente a `node1`. Una MAC no
registrada o un perfil que no corresponde se rechazan antes de compilar y grabar.

Agregue `-Monitor` si desea abrir el monitor serie después de grabar. El COM
puede cambiar entre conexiones sin alterar la identidad ni el perfil de la placa.

Los nodos no usan TCP, HTTP ni Socket.IO. ESP-NOW transmite tramas Wi-Fi
directas. Cada enlace nodo-gateway es unicast con LMK (AES-CCMP de ESP-NOW),
y la carga útil de cada trama usa además AES-256-GCM a nivel de aplicación.
Los metadatos y el ciphertext quedan autenticados por GCM y HMAC-SHA256.

## Provisionamiento

`main/config.c` contiene credenciales y claves de cada instalación, por lo que
está excluido de Git. En una instalación nueva, genere el archivo localmente con
`node generate_kit_config.js kit-manifest.local.json main/config.c` (el manifiesto
también debe mantenerse fuera de Git). `main/config.example.c` documenta la
estructura sin secretos. No compile ni grabe la plantilla de ejemplo en equipos
reales.

1. Asigne MAC y LMK únicos por nodo en `GATEWAY_PEERS`; copie el mismo LMK y
   MAC del gateway en el firmware de ese nodo.
2. Ponga la misma clave HMAC de 64 caracteres para cada nodo en ambos lados.
3. Configure `WIFI_SSID` con la red del gateway. Los nodos detectan su canal al
   arrancar; `ESPNOW_CHANNEL` sólo es el respaldo si el SSID no está visible.
4. Configure Wi-Fi y una URL **HTTPS** para `UPSTREAM_URL` sólo en la imagen
   del gateway. No use los valores de ejemplo en producción.

El inventario de placas y MAC detectadas está en `BOARD_INVENTORY.md`. Los
perfiles pendientes no son añadidos como peers del gateway hasta conocer su
MAC, evitando que una placa ausente impida iniciar ESP-NOW.

## Contrato HTTP con el backend

El backend implementa `POST /api/gateway/sync`, protegido con HMAC de nodo.
El gateway envía:

```json
{"deviceId":"esp32-001","sequence":123,"type":1,"payload":"online"}
```

y puede recibir órdenes para ese mismo nodo:

```json
{"commands":[{"deviceId":"esp32-001","type":"command","payload":"..."}]}
```

Para rotar una clave, `type` es `rotate_key` y `payload` contiene la nueva
clave hexadecimal de 64 caracteres. Durante la transición el backend acepta
temporalmente la clave anterior; la elimina cuando recibe una petición válida
firmada con la nueva. La orden viaja cifrada por ESP-NOW y se persiste en NVS.
