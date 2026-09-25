# Informe consolidado de pruebas: ESP32 ↔ gateway ↔ backend ↔ web

**Fecha de corte:** 16 de septiembre de 2026 (hora de Colombia, UTC−5).  
**Alcance:** tres nodos ESP32 físicos, un gateway ESP32, backend local, aplicación web y simulador.  
**Identidad de los equipos:** la MAC, no el puerto COM. El COM solo se usó temporalmente para verificar y grabar firmware.

| Equipo | Identificador | MAC |
| --- | --- | --- |
| Gateway | gateway | `B0:3F:D3:5B:50:B4` |
| Nodo 1 | `esp32-001` | `20:50:0D:17:C8:D0` |
| Nodo 2 | `esp32-002` | `04:B2:47:54:DA:90` |
| Nodo 3 | `esp32-003` | `20:50:0D:17:EC:64` |

## Resumen ejecutivo

La cadena física funcionó con los tres nodos: cada uno envió latidos por ESP-NOW al gateway y estos llegaron al backend. Durante tres minutos con los tres nodos cercanos se recibieron **54 latidos (18 por nodo)** y la presencia simultánea fue **100 %**. A aproximadamente **10 m**, el nodo 2 continuó comunicándose, pero perdió continuidad: en la prueba corta se observaron **5 saltos de secuencia de 18 intentos inferidos (27,78 %)**. En el registro prolongado solicitado de **una hora**, los nodos 1 y 3 recibieron 364 y 365 latidos; el nodo 2 recibió 77 y dejó de enviar datos durante los últimos **30 min 58,689 s**, pese a seguir alimentado según confirmación del usuario. La presencia simultánea de los tres fue **31,23 %**.

La reconexión controlada del nodo 1 tardó **3,766 s** desde que se liberó su reset hasta el primer latido recibido por el backend. Se obtuvo telemetría de memoria y una estimación de CPU de los tres nodos. **No se midió consumo eléctrico**: no había un medidor de corriente/energía. Las pruebas automáticas actuales pasaron: backend **41/41**, frontend **8/8** y simulador **13/13**. No se realizaron sesiones de usabilidad con participantes ni se calculó SUS.

## Preparación y validez de las mediciones

- Gateway conectado al hotspot local de Windows y al backend en `192.168.137.1:5000`; los nodos se comunicaron con el gateway por ESP-NOW. El hotspot y el backend estuvieron activos durante las mediciones físicas.
- Los perfiles físicos se identificaron por MAC antes de grabar. El nodo 2 tenía una imagen de aplicación incompleta tras una interrupción previa de USB; el arranque mostró `invalid segment length` y `No bootable app partitions`. Fue regrabado, verificado por hash y volvió a enviar telemetría. **La primera ventana de 10 m con 0 paquetes se excluye de las conclusiones de alcance** porque el firmware no arrancaba.
- Los nodos 1, 2 y 3 quedaron con firmware de telemetría antes de iniciar la hora prolongada. El nodo 3, en la prueba cercana de tres minutos, aún usaba el firmware anterior, por lo que allí no hay RTT, secuencias ni CPU para ese nodo.
- Cada nodo emite un heartbeat nominalmente cada 10 s. El RTT registrado incluye ida nodo → ESP-NOW → gateway → petición/respuesta HTTP del backend y vuelta del ACK. **No es latencia unidireccional.**
- La pérdida exacta que ofrece el informe automático se calcula por huecos entre números de secuencia recibidos dentro de un mismo arranque. No puede contar paquetes anteriores al primero ni posteriores al último recibido. La presencia simultánea considera un nodo presente si tuvo un latido en los 25 s previos, después de 20 s de calentamiento.
- El firmware conserva el último RTT válido si no llega un ACK nuevo. Por eso los promedios de RTT del nodo 2 durante las caídas pueden incluir valores repetidos y deben interpretarse con cautela.

## Resultados por prueba solicitada

### 1. Latencia extremo a extremo

| Escenario | Nodo | RTT medio | Percentil 95 | Máximo |
| --- | --- | ---: | ---: | ---: |
| Tres nodos cercanos, 3 min | 1 | 198,56 ms | 509 ms | 509 ms |
| Tres nodos cercanos, 3 min | 2 | 197,44 ms | 377 ms | 377 ms |
| Nodo 2 a ~10 m, 3 min | 2 | 308,85 ms | 662 ms | 662 ms |
| Registro de 1 h, nodos 1 y 3 cercanos | 1 | 281,29 ms | 430 ms | 1.029 ms |
| Registro de 1 h, nodos 1 y 3 cercanos | 3 | 298,45 ms | 437 ms | 3.180 ms |
| Registro de 1 h, nodo 2 a ~10 m | 2 | 348,87 ms | 501 ms | 559 ms |

La comparación cercana/10 m del nodo 2 sugiere mayor demora en esa ubicación, pero no aísla el efecto de la distancia frente a obstáculos e interferencias. El RTT del nodo 2 puede estar desactualizado cuando faltan ACK.

### 2. Porcentaje de paquetes perdidos

| Ventana | Nodo 1 | Nodo 2 | Nodo 3 | Interpretación |
| --- | ---: | ---: | ---: | --- |
| Cercanos, 3 min | 0/18, **0 %** | 0/18, **0 %** | N/D | Nodo 3 aún no enviaba secuencia. |
| Nodo 2 a ~10 m, 3 min | — | 5/18, **27,78 %** | — | Huecos entre latidos recibidos. |
| Una hora, nodo 2 a ~10 m | 1/365, **0,27 %** | 98/175, **56 %** | 0/365, **0 %** | Solo huecos de secuencia observables. |

**Importante:** el **56 % del nodo 2 no es su pérdida real de toda la hora**. Su último latido fue a las 12:51:49 y el registro acabó a las 13:22:47. Los últimos ~31 minutos sin ningún paquete no entran en el denominador de secuencias porque no hubo un paquete posterior. Con el ritmo nominal de 10 s, los 77 latidos recibidos equivalen aproximadamente al **21 % de los ~360 latidos esperables en una hora**; esta es una estimación de entrega de ventana, no un conteo exacto de tramas transmitidas.

### 3. Rendimiento con tres nodos simultáneos

| Escenario | Duración | Latidos recibidos | Rendimiento agregado | Presencia simultánea |
| --- | ---: | ---: | ---: | ---: |
| Tres nodos cercanos | 180 s | 54 (18 por nodo) | 0,300 paquetes/s | 100 % |
| Registro prolongado: nodo 2 a ~10 m | 3.600,93 s | 806 (364 / 77 / 365) | 0,2238 paquetes/s | 31,23 % |

La caída de rendimiento agregado en la hora se explica principalmente por las ausencias del nodo 2 a ~10 m. Los nodos cercanos sostuvieron alrededor de un latido cada 10 s cada uno. Esta prueba mide tráfico de heartbeat, **no capacidad máxima de datos ni saturación del canal**.

### 4. Alcance y estabilidad según distancia

Se comparó una posición cercana **sin distancia exacta medida** con una posición del nodo 2 de **aproximadamente 10 m**, indicada por el usuario. Cerca del gateway, el nodo 2 entregó 18/18 latidos inferidos en tres minutos. A ~10 m, entregó 13 y faltaron 5 entre secuencias; estuvo presente el 90,63 % de esa ventana corta. En la hora posterior, con el nodo 2 aún a ~10 m, hubo recuperaciones automáticas tras pausas y finalmente una ausencia continua de 30 min 58,689 s. El usuario confirmó que seguía alimentado.

**Conclusión de alcance:** hubo comunicación a ~10 m, pero **no fue estable en el montaje probado**. No se midieron posiciones intermedias, línea de vista, obstáculos ni potencia RSSI; por tanto, no se puede fijar un alcance máximo ni atribuir la falla únicamente a la distancia. La primera prueba de 10 m con 0 paquetes fue inválida por el firmware incompleto y no se usa como evidencia de alcance.

### 5. Tiempo de reconexión

Se mantuvo el nodo 1 en reset durante 60 s. El backend lo mostró desconectado cuando la edad del último latido llegó a 61,94 s. Desde liberar el reset hasta recibir su primer latido pasaron **3,766 s**. Es **una sola repetición en el nodo 1**; no caracteriza variación estadística ni reconexión del nodo 2 a ~10 m. En la hora del nodo 2 se observaron recuperaciones espontáneas, pero su duración no se toma como un tiempo de reconexión controlado.

### 6. Memoria, CPU y energía

| Nodo | Heap libre mínimo durante 1 h | Heap mínimo histórico reportado | CPU media estimada | CPU p95 estimada |
| --- | ---: | ---: | ---: | ---: |
| 1 | 217.440 B | 216.472 B | 0,05 % | 0,06 % |
| 2 | 217.440 B | 216.472 B | 0,05 % | 0,07 % |
| 3 | 217.440 B | 216.468 B | 0,06 % | 0,06 % |

La CPU proviene de contadores de ejecución de tareas FreeRTOS y es una **estimación de carga**, no una medición eléctrica ni un perfil completo del SoC. La memoria procede de los contadores de heap del ESP-IDF. **Consumo de corriente, potencia y energía: no medidos** porque no se disponía de un medidor USB; no se asignan valores supuestos.

### 7. Prueba prolongada

Por petición posterior del usuario, la duración se redujo de tres horas a **una hora total**, sin descartar los datos iniciales: de **12:22:47 a 13:22:47, hora de Colombia**. Hubo 806 latidos recibidos. Los nodos 1 y 3 permanecieron regulares, sin reinicios detectados por sus secuencias y con 0,27 % y 0 % de pérdida observable respectivamente. El nodo 2, alimentado a ~10 m, tuvo 56 % de pérdida entre secuencias observadas y dejó de entregar datos durante los últimos ~31 minutos. La presencia simultánea de los tres fue 31,23 %. **No se ejecutó una prueba de varias horas**, porque el usuario estableció el límite de una hora.

## Integración, software y usabilidad

- **Integración física:** el 14 de septiembre se verificó con el nodo 1 el recorrido heartbeat cifrado → gateway → `POST /api/gateway/sync` → estado activo en backend, además de rotación real de clave y ACK, persistente tras reinicio. El 16 de septiembre se observaron latidos físicos de los tres nodos con sus MAC registradas y telemetría en el backend.
- **Identidad y grabación:** la selección de perfil por MAC rechazó un perfil incompatible antes de grabar. Los puertos COM no se almacenan como identidad y pueden cambiar al reconectar.
- **Pruebas automáticas ejecutadas nuevamente el 16 de septiembre:** backend **41/41** en 3 suites; frontend **8/8** en 2 suites; simulador **13/13** en 1 suite. Son pruebas de código, no sustituyen la validación física de radio ni una evaluación humana.
- **Usabilidad automatizada:** las siete tareas documentadas (iniciar sesión, registrar nodo, identificar estado, bloquear nodo, encontrar alerta, rotar clave y cerrar sesión) están cubiertas por pruebas; frontend 8/8. **Pendiente:** cinco sesiones con participantes, tiempos de tarea y cuestionario SUS. No existen resultados humanos ni puntaje SUS legítimos.

## Registros complementarios y descartes

- El 14 de septiembre se hizo una línea base de 120 s con el firmware anterior: 36 latidos, 12 por nodo. Confirma comunicación física de los tres, pero no tiene telemetría comparable de RTT, CPU o secuencias. No se usa su porcentaje de presencia calculado con el método anterior.
- El 16 de septiembre hubo una ventana parcial de 180 s con los nodos 1 y 3: 18 latidos de cada uno y presencia simultánea de ambos del 100 %. No sustituye la prueba posterior de los tres nodos.
- La primera ventana de 10 m del nodo 2 registró 0 paquetes, pero se descartó para evaluar alcance porque después se comprobó que su aplicación estaba incompleta y no arrancaba. La ventana válida es la posterior a la reparación.

## Limitaciones y trabajo pendiente

1. Diagnosticar la ausencia prolongada del nodo 2 a ~10 m con captura serie simultánea, potencia/RSSI si el hardware lo permite y repetición en posiciones controladas. La evidencia actual no distingue de forma definitiva un problema de radio, interferencia u otra falla del nodo.
2. Repetir alcance a distancias conocidas y bajo condiciones documentadas (obstáculos, línea de vista, alimentación y canal Wi-Fi).
3. Repetir reconexión varias veces y en los tres nodos para informar media, dispersión y peor caso.
4. Medir energía con voltaje y corriente reales mediante instrumento externo.
5. Realizar las sesiones humanas de usabilidad antes de informar satisfacción o SUS.
6. Si se requiere capacidad máxima de la red, ejecutar una prueba de carga con tamaños y tasas de tráfico definidos; los heartbeats actuales solo miden la carga normal del sistema.

## Evidencia reproducible

- [Integración física y usabilidad inicial](informe_integracion_y_usabilidad.md)
- [Plan de usabilidad](plan_pruebas_usabilidad.md)
- [Línea base inicial de tres nodos](resultados_rendimiento/2026-09-14T23-06-19-630Z-baseline-tres-nodos.md)
- [Ventana parcial de dos nodos](resultados_rendimiento/2026-09-16T17-01-00-000Z-concurrencia-dos-nodos-parcial.md)
- [Primera ventana de 10 m descartada](resultados_rendimiento/2026-09-16T16-57-40-123Z-alcance-nodo2-10m.md)
- [Tres nodos cercanos, 3 min](resultados_rendimiento/2026-09-16T17-09-41-274Z-tres-nodos-simultaneos-reparados.md)
- [Nodo 2 a ~10 m con firmware reparado, 3 min](resultados_rendimiento/2026-09-16T17-14-14-988Z-alcance-nodo2-10m-firmware-reparado.md)
- [Reconexión controlada del nodo 1](resultados_rendimiento/2026-09-16T16-55-20Z-reconexion-esp32-001.json)
- [Prueba de una hora: informe legible](resultados_rendimiento/2026-09-16T17-22-47-000Z-prueba-prolongada-tres-nodos-1h.md)
- [Prueba de una hora: datos estructurados](resultados_rendimiento/2026-09-16T17-22-47-000Z-prueba-prolongada-tres-nodos-1h.json)

Al finalizar la captura, el monitor terminó y se verificó que el puerto 5000 estaba cerrado; no quedó el backend de esta prueba ejecutándose en segundo plano.
