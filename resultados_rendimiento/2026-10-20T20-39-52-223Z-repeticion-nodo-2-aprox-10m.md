# Prueba de rendimiento: repeticion-nodo-2-aprox-10m

- Inicio: 2026-10-20T20:39:52.223Z
- Fin: 2026-10-20T20:42:52.252Z
- Duración: 180.03 s
- Escenario/distancia: aprox-10-m
- Paquetes recibidos: 17
- Rendimiento agregado: 0.0944 paquetes/s
- Presencia simultánea de los 1 nodo(s) seleccionados: 100%

| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |
|---|---|---:|---:|---:|---|---|---:|
| esp32-002 | 38:18:2B:8A:16:6C | 17 | 1 | 5.56% | N/D | 0.06% / 0.06% | 217544 |

- RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.
- La pérdida es de saltos de secuencia entre paquetes recibidos por cada arranque; no incluye pérdidas anteriores/posteriores ni durante reinicios.
- La presencia simultánea se calcula cada segundo con una tolerancia de 25 s, tras 20 s de calentamiento.
- El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.
