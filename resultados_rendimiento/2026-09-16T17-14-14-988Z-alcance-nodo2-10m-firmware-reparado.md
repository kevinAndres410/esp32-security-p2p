# Prueba de rendimiento: alcance-nodo2-10m-firmware-reparado

- Inicio: 2026-09-16T17:14:14.988Z
- Fin: 2026-09-16T17:17:15.011Z
- Duración: 180.02 s
- Escenario/distancia: aproximadamente-10m
- Paquetes recibidos: 13
- Rendimiento agregado: 0.0722 paquetes/s
- Presencia simultánea de los 1 nodo(s) seleccionados: 90.63%

| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |
|---|---|---:|---:|---:|---|---|---:|
| esp32-002 | 04:B2:47:54:DA:90 | 13 | 5 | 27.78% | 308.85 / 662 / 662 | 0.07% / 0.17% | 217440 |

- RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.
- La pérdida es de saltos de secuencia entre paquetes recibidos por cada arranque; no incluye pérdidas anteriores/posteriores ni durante reinicios.
- La presencia simultánea se calcula cada segundo con una tolerancia de 25 s, tras 20 s de calentamiento.
- El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.
