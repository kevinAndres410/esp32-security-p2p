# Prueba de rendimiento: nodo1-latencia-memoria-cpu

- Inicio: 2026-09-16T16:52:17.332Z
- Fin: 2026-09-16T16:54:17.353Z
- Duración: 120.02 s
- Escenario/distancia: cercana-sin-medir
- Paquetes recibidos: 12
- Rendimiento agregado: 0.1 paquetes/s
- Presencia simultánea de los 1 nodo(s) seleccionados: 100%

| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |
|---|---|---:|---:|---:|---|---|---:|
| esp32-001 | 20:50:0D:17:C8:D0 | 12 | 0 | 0% | 213.17 / 336 / 336 | 0.06% / 0.06% | 217440 |

- RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.
- La pérdida es de secuencias de heartbeat entre el primer y el último paquete recibidos; no incluye pérdidas anteriores/posteriores a esa ventana.
- La presencia simultánea se calcula cada segundo con una tolerancia de 25 s, tras 20 s de calentamiento.
- El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.
