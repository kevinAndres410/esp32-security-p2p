# Incorporación dinámica de nodos

## Preparación única del kit existente

El Gateway necesita una versión del firmware que consulte la configuración del servidor. Para migrar un kit ya instalado, conserve una copia privada de la base de datos y de `firmware/esp32_node_idf/main/config.c` y ejecute desde `backend`:

```powershell
node scripts/prepare-dynamic-kit.js 1 ../firmware/esp32_node_idf/main/config.c
```

El script comprueba las MAC y los identificadores existentes, registra las claves ESP-NOW de los pares actuales y crea una clave de control exclusiva del Gateway. La clave de control y el inventario completo solo se incluyen cuando se compila el perfil `gateway`; cada perfil de nodo conserva únicamente sus propias credenciales. Después compile el perfil `gateway` y grabe la aplicación en la placa correspondiente. La migración conserva los datos NVS, incluido el acceso a la red Wi-Fi y las claves rotadas. La clave de control también queda guardada cifrada en la base de datos; la copia privada de `config.c` debe mantenerse fuera del repositorio.

## Preparar una placa nueva

Cada placa se graba antes de ofrecerla al usuario. Lea su MAC física por USB y ejecute desde `backend`:

```powershell
node scripts/provision-factory-node.js 1 esp32-004 AA:BB:CC:DD:EE:FF ../firmware/esp32_node_idf/main/config.c ../artifacts/factory/esp32-004
```

El script asigna a la placa un identificador, una clave HMAC, una LMK ESP-NOW y un código de activación de un solo uso. Genera `config.c` y `activation-code.txt` privados. Compile el perfil `node1` con ese `config.c` usando `build_profiles.ps1 -Profile node1 -KitConfig <ruta-config.c> -KitId <identificador>` y grábelo en la placa cuya MAC se indicó. El firmware comprueba la MAC al arrancar. El código de activación se entrega al propietario por un canal privado. Nunca se introduce la clave HMAC, la LMK ni la clave del Gateway en la web.

## Operar desde la web

En **Mis dispositivos**, el propietario abre el kit y usa **Agregar**, **Reemplazar** o **Eliminar**. Agregar y reemplazar requieren el código de activación de una placa preparada para ese kit. El servidor invalida inmediatamente el registro y las claves operativas de la placa retirada. El cambio permanece **pendiente del Gateway** mientras este está desconectado. Cuando el Gateway aplica y confirma la versión nueva, pasa a **esperando datos del nodo**. Solo aparece **en línea** después de recibir una trama real autenticada de esa placa. Eliminar se completa cuando el Gateway confirma la retirada del par ESP-NOW.

El Gateway conserva en NVS la última lista válida. Si una configuración no se puede verificar o aplicar, mantiene la anterior y vuelve a pedirla. La configuración viaja cifrada y autenticada con AES-256-GCM; las solicitudes y confirmaciones se firman con HMAC y usan nonces. Las rotaciones de claves en curso incluyen la clave anterior para que el Gateway conserve la que ya usa hasta completar la rotación.

El firmware ESP32 actual admite hasta **7 pares ESP-NOW cifrados** por Gateway. El servidor y la interfaz rechazan un octavo nodo. Un Gateway sin conexión no puede recibir una revocación nueva hasta reconectarse; el servidor deja de aceptar de inmediato los mensajes de la placa revocada.
