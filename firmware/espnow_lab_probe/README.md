# ESP32-S3 de laboratorio para la Tabla 8A

Perfil independiente para la placa de prueba con MAC `FC:01:2C:CB:36:50`.
La MAC se comprueba al arrancar. Este firmware no contiene las claves de los
nodos ni se incorpora al inventario del gateway.

## Funciones

- Escucha tramas de acción ESP-NOW dirigidas al gateway o emitidas por él.
  Muestra canal, RSSI, MAC, longitud y bytes capturados en hexadecimal por USB.
- Recorre los canales 1 a 13 hasta ver una trama del gateway y entonces fija
  el canal. También se puede fijar manualmente con `channel 11`, por ejemplo.
- `probe` envía **una sola** trama de protocolo sin LMK ni HMAC válidos desde
  la MAC no inventariada. Sirve para comprobar el rechazo del dispositivo
  desconocido; el resultado de `esp_now_send` no prueba aceptación.

Comandos serie a 115200: `status`, `channel 1..13`, `hop`, `probe`, `help`.
Las líneas `CAPTURE ... hex=...` son datos de radio; guárdelas junto con la
hora del equipo y los registros del gateway/backend. No publicarlas sin
revisar posibles metadatos sensibles.

Para conservar la salida y abrir la captura en Wireshark, use el Python de
ESP-IDF (incluye pyserial) mientras la placa está conectada:

```powershell
& 'C:\Espressif\tools\python\v6.1-beta1\venv\Scripts\python.exe' .\capture.py --port COM9 --seconds 60 --output .\captura-lab
```

El puerto puede cambiar. El archivo `.log` conserva respuestas como `PROBE`;
el `.pcap` contiene únicamente las tramas 802.11 observadas por la placa.

Este firmware no puede reproducir de forma válida una trama cifrada de un
nodo inventariado: la placa tiene otra MAC y carece de su LMK y clave HMAC.
Tampoco sustituye una captura PCAP con un adaptador Wi-Fi compatible con
modo monitor e inyección de tramas 802.11.
