# Firmware ESP-NOW gateway

Este proyecto ESP-IDF 6.1 se graba tanto en nodos como en el gateway. El rol se
selecciona en `main/config.c`: `DEVICE_ROLE_NODE` para sensores/actuadores y
`DEVICE_ROLE_GATEWAY` para el único dispositivo con Wi-Fi/IP.

Los nodos no usan TCP, HTTP ni Socket.IO. ESP-NOW tampoco es TCP: transmite
tramas Wi-Fi directas. Cada enlace nodo-gateway es unicast con LMK (cifrado
AES-CCMP de ESP-NOW), y cada mensaje lleva además HMAC-SHA256 con la clave de
aplicación existente. El HMAC conserva la compatibilidad semántica con Node:
la clave hexadecimal se usa como texto ASCII, igual que `createHmac` actual.

## Provisionamiento

1. Asigne MAC y LMK únicos por nodo en `GATEWAY_PEERS`; copie el mismo LMK y
   MAC del gateway en el firmware de ese nodo.
2. Ponga la misma clave HMAC de 64 caracteres para cada nodo en ambos lados.
3. Ajuste `ESPNOW_CHANNEL` al canal real del AP al que se une el gateway. Todos
   los nodos deben usar exactamente ese canal.
4. Configure Wi-Fi y una URL **HTTPS** para `UPSTREAM_URL` sólo en la imagen
   del gateway. No use los valores de ejemplo en producción.

## Contrato HTTP que falta en el backend

El backend actual sólo usa Socket.IO para nodos, por lo que no es compatible
con esta arquitectura todavía. Debe implementar `POST /api/gateway/sync`,
protegido con el middleware HMAC de nodo existente. El gateway envía:

```json
{"deviceId":"esp32-001","sequence":123,"type":1,"payload":"online"}
```

y puede recibir órdenes para ese mismo nodo:

```json
{"commands":[{"deviceId":"esp32-001","type":"command","payload":"..."}]}
```

Para rotar una clave, `type` es `rotate_key` y `payload` contiene la nueva
clave hexadecimal de 64 caracteres. La orden viaja por ESP-NOW cifrado y se
vuelve a autenticar con la clave anterior antes de persistirse en NVS.
