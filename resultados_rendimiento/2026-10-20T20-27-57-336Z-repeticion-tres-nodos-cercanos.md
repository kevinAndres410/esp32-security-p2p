# Prueba de rendimiento: repeticion-tres-nodos-cercanos

- Inicio: 2026-10-20T20:27:57.336Z
- Fin: 2026-10-20T20:30:57.363Z
- Duración: 180.03 s
- Escenario/distancia: misma-habitacion
- Paquetes recibidos: 54
- Rendimiento agregado: 0.3 paquetes/s
- Presencia simultánea de los 3 nodo(s) seleccionados: 100%

| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |
|---|---|---:|---:|---:|---|---|---:|
| esp32-001 | 20:50:0D:17:C8:D0 | 18 | 0 | 0% | 438.78 / 699 / 699 | 0.05% / 0.05% | 217444 |
| esp32-002 | 38:18:2B:8A:16:6C | 18 | 0 | 0% | 384.72 / 593 / 593 | 0.06% / 0.06% | 217676 |
| esp32-003 | 20:50:0D:17:EC:64 | 18 | 0 | 0% | 379.83 / 638 / 638 | 0.05% / 0.05% | 217444 |

- RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.
- La pérdida es de saltos de secuencia entre paquetes recibidos por cada arranque; no incluye pérdidas anteriores/posteriores ni durante reinicios.
- La presencia simultánea se calcula cada segundo con una tolerancia de 25 s, tras 20 s de calentamiento.
- El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.
