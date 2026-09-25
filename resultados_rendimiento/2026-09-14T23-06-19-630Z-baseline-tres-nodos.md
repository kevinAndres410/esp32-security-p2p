# Prueba de rendimiento: baseline-tres-nodos

- Inicio: 2026-09-14T23:06:19.630Z
- Fin: 2026-09-14T23:08:19.661Z
- Duración: 120.03 s
- Escenario/distancia: misma-habitacion
- Paquetes recibidos: 36
- Rendimiento agregado: 0.2999 paquetes/s
- Presencia simultánea de los tres nodos: 88.89%

| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |
|---|---|---:|---:|---:|---|---|---:|
| esp32-001 | 20:50:0D:17:C8:D0 | 12 | N/D | N/D | N/D | N/D | N/D |
| esp32-002 | 04:B2:47:54:DA:90 | 12 | N/D | N/D | N/D | N/D | N/D |
| esp32-003 | 20:50:0D:17:EC:64 | 12 | N/D | N/D | N/D | N/D | N/D |

- RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.
- La pérdida exacta se calcula únicamente cuando el firmware reporta secuencia de heartbeat.
- El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.
