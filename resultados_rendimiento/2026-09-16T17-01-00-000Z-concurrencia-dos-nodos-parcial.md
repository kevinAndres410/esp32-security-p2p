# Prueba de rendimiento: concurrencia-dos-nodos-parcial

- Inicio: 2026-09-16T17:01:00.000Z
- Fin: 2026-09-16T17:04:00.000Z
- Duración: 180 s
- Escenario/distancia: cercana-sin-medir
- Paquetes recibidos: 36
- Rendimiento agregado: 0.2 paquetes/s
- Presencia simultánea de los 2 nodo(s) seleccionados: 100%

| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |
|---|---|---:|---:|---:|---|---|---:|
| esp32-001 | 20:50:0D:17:C8:D0 | 18 | 0 | 0% | 185.59 / 228 / 228 | 0.34% / 5.15% | 217440 |
| esp32-003 | 20:50:0D:17:EC:64 | 18 | N/D | N/D | N/D | N/D | N/D |

- RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.
- La pérdida es de saltos de secuencia entre paquetes recibidos por cada arranque; no incluye pérdidas anteriores/posteriores ni durante reinicios.
- La presencia simultánea se calcula cada segundo con una tolerancia de 25 s, tras 20 s de calentamiento.
- El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.
