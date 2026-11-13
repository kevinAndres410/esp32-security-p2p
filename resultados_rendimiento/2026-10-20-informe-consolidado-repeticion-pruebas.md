# Informe consolidado de la repetición de pruebas físicas

**Fecha:** 20 de octubre de 2026 (hora de Bogotá).  
**Sistema:** gateway ESP32 y nodos `esp32-001`, `esp32-002` y `esp32-003` mediante ESP-NOW.

Antes de las mediciones se comprobó que los tres nodos enviaban heartbeats recientes al backend. El nodo 1 volvió a comunicar después de resolver una rotación de clave pendiente: la clave activa de su NVS coincidía con la clave actual del backend, mientras la configuración del gateway conservaba la clave anterior.

## Tabla 7. Resultados físicos repetidos

| Prueba | Resultado | Interpretación |
|---|---|---|
| Tres nodos cercanos durante 3 min | 54 heartbeats (18 por nodo), 0 huecos de secuencia y presencia simultánea del 100 %. | El recorrido completo funcionó durante esta repetición bajo la carga nominal. |
| Nodo 2 a aproximadamente 10 m durante 3 min | 17 heartbeats recibidos de 18 intentos inferidos; 1 hueco y pérdida observable del 5,56 %. | Hubo una interrupción de entrega. El RTT no estuvo disponible en las muestras de este escenario. |
| Registro de una hora con tres nodos cercanos | 1.093 heartbeats: 365 del nodo 1, 364 del nodo 2 y 364 del nodo 3; 0 huecos de secuencia y presencia simultánea del 100 %. | Los tres nodos permanecieron presentes durante toda la ventana medida con la tolerancia definida. |
| Reconexión controlada del nodo 1 | Se mantuvo en reset 60 s; estado desconectado observado; 3,879 s desde la liberación hasta el primer heartbeat recibido por el backend. | El nodo se recuperó en esta observación. Es una sola repetición y no constituye una estimación estadística. |
| Recursos durante una hora | Heap libre mínimo entre muestras de 217.444 B; CPU media estimada entre 0,05 % y 0,06 % según el nodo. | No se observó agotamiento de memoria ni carga elevada de CPU durante esta ejecución. |

**Fuente:** informes generados por el monitor de rendimiento y la prueba de reconexión del proyecto el 20 de octubre de 2026.

## Alcance de los resultados

- La distancia de 10 m es aproximada e indicada por el operador; no se midió instrumentalmente.
- La pérdida observable se calcula con los huecos entre números de secuencia recibidos. No incluye intentos anteriores al primer paquete ni posteriores al último de cada ventana.
- La presencia simultánea se evalúa cada segundo con 25 s de tolerancia después de 20 s de calentamiento.
- El RTT comprende nodo, ESP-NOW, gateway, petición y respuesta HTTP del backend y ACK de vuelta. No hubo un valor de RTT utilizable en la prueba de 10 m.
- Las mediciones no incluyen consumo eléctrico; eso exige medir corriente y voltaje con instrumentos externos.
- Cada escenario se ejecutó una vez. Los resultados describen estas ejecuciones y no caracterizan la variación entre días o ubicaciones.

## Evidencia original

- [Tres nodos cercanos, 3 min](2026-10-20T20-27-57-336Z-repeticion-tres-nodos-cercanos.json)
- [Nodo 2 a aproximadamente 10 m, 3 min](2026-10-20T20-39-52-223Z-repeticion-nodo-2-aprox-10m.json)
- [Registro de una hora y recursos](2026-10-20T20-44-43-253Z-repeticion-registro-una-hora-posicion-restaurada.json)
- [Reconexión del nodo 1](2026-10-20T21-49-08Z-reconexion-esp32-001.json)
