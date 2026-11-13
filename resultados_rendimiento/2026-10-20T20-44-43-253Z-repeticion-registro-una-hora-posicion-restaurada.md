# Prueba de rendimiento: repeticion-registro-una-hora-posicion-restaurada

- Inicio: 2026-10-20T20:44:43.253Z
- Fin: 2026-10-20T21:44:43.283Z
- Duración: 3600.03 s
- Escenario/distancia: misma-habitacion
- Paquetes recibidos: 1093
- Rendimiento agregado: 0.3036 paquetes/s
- Presencia simultánea de los 3 nodo(s) seleccionados: 100%

| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |
|---|---|---:|---:|---:|---|---|---:|
| esp32-001 | 20:50:0D:17:C8:D0 | 365 | 0 | 0% | 430.79 / 655 / 9369 | 0.05% / 0.05% | 217444 |
| esp32-002 | 38:18:2B:8A:16:6C | 364 | 0 | 0% | 447.21 / 875 / 6225 | 0.06% / 0.06% | 217544 |
| esp32-003 | 20:50:0D:17:EC:64 | 364 | 0 | 0% | 472.04 / 954 / 6676 | 0.05% / 0.05% | 217444 |

- RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.
- La pérdida es de saltos de secuencia entre paquetes recibidos por cada arranque; no incluye pérdidas anteriores/posteriores ni durante reinicios.
- La presencia simultánea se calcula cada segundo con una tolerancia de 25 s, tras 20 s de calentamiento.
- El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.
