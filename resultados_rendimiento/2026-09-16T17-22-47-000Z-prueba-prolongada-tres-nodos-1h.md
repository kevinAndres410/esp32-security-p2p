# Prueba de rendimiento: prueba-prolongada-tres-nodos-1h

- Inicio: 2026-09-16T17:22:47.000Z
- Fin: 2026-09-16T18:22:47.928Z
- Duración: 3600.93 s
- Escenario/distancia: nodo2-aproximadamente-10m-otros-cerca
- Paquetes recibidos: 806
- Rendimiento agregado: 0.2238 paquetes/s
- Presencia simultánea de los 3 nodo(s) seleccionados: 31.23%

| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |
|---|---|---:|---:|---:|---|---|---:|
| esp32-001 | 20:50:0D:17:C8:D0 | 364 | 1 | 0.27% | 281.29 / 430 / 1029 | 0.05% / 0.06% | 217440 |
| esp32-002 | 04:B2:47:54:DA:90 | 77 | 98 | 56% | 348.87 / 501 / 559 | 0.05% / 0.07% | 217440 |
| esp32-003 | 20:50:0D:17:EC:64 | 365 | 0 | 0% | 298.45 / 437 / 3180 | 0.06% / 0.06% | 217440 |

- RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.
- La pérdida es de saltos de secuencia entre paquetes recibidos por cada arranque; no incluye pérdidas anteriores/posteriores ni durante reinicios.
- El nodo 2 tuvo su último latido a las 17:51:49.239Z: permaneció sin datos los últimos 30 min 58.689 s de la ventana, aunque seguía alimentado. Por tanto, su 56% de pérdida entre secuencias recibidas subestima la ausencia durante toda la hora; no es una tasa de pérdida de hora completa.
- El RTT enviado por el firmware puede conservar la última respuesta válida cuando no llega un nuevo ACK; interpretar con cautela el promedio del nodo 2 durante los cortes.
- La presencia simultánea se calcula cada segundo con una tolerancia de 25 s, tras 20 s de calentamiento.
- El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.
