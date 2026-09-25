# Informe de integración física y usabilidad

Fecha de ejecución: 14 de septiembre de 2026.

## Estado del registro

Los tres nodos están registrados en el backend con una MAC única. El puerto COM
no forma parte de su identidad y no se almacena en el inventario.

| Nodo | MAC | Estado al terminar la prueba |
| --- | --- | --- |
| `esp32-001` | `20:50:0D:17:C8:D0` | Activo y validado físicamente |
| `esp32-002` | `04:B2:47:54:DA:90` | Registrado; pendiente de grabación física |
| `esp32-003` | `20:50:0D:17:EC:64` | Registrado; pendiente de grabación física |

Gateway registrado en el inventario de firmware: MAC
`B0:3F:D3:5B:50:B4`.

## Integración ESP32 ↔ gateway ↔ backend

Resultado: **ejecutada satisfactoriamente con el nodo físico `esp32-001`**.

Evidencias observadas:

1. El script leyó la MAC física del nodo y seleccionó el perfil `node1`.
2. Se comprobó el control negativo: intentar grabar el perfil `gateway` sobre
   esa MAC fue rechazado antes de compilar o escribir la memoria.
3. El nodo descubrió el SSID local y cambió automáticamente al canal 11.
4. El gateway se conectó al hotspot, obtuvo la IP `192.168.137.64` y operó en
   el mismo canal 11.
5. El heartbeat cifrado viajó por ESP-NOW, el gateway lo autenticó y lo envió a
   `POST /api/gateway/sync`.
6. El backend cambió `esp32-001` de `pendiente` a `activo` y actualizó su última
   actividad.
7. Se solicitó una rotación real: la orden recorrió backend → gateway → nodo,
   el nodo devolvió el ACK y el backend registró `rotacion_confirmada`.
8. Después de reiniciar nodo y gateway, `esp32-001` volvió a autenticarse con
   la clave rotada; no quedó una rotación pendiente. Esto valida NVS.

El hotspot de Windows debe estar encendido para exponer `192.168.137.1`. El
firmware ya no depende de que su canal sea fijo: los nodos lo descubren al
arrancar y los peers siguen el canal actual de la radio.

## Pruebas de usabilidad reproducibles

Resultado: **7 de 7 tareas cubiertas y aprobadas automáticamente**.

| Tarea | Validación | Resultado |
| --- | --- | --- |
| Iniciar sesión | Campos accesibles, envío y entrada al sistema | Aprobada |
| Registrar nodo | Formulario exige identificador y MAC válida | Aprobada |
| Identificar estado | Se distinguen Activo e Inactivo | Aprobada |
| Bloquear nodo | La acción se aplica al identificador visible | Aprobada |
| Encontrar alerta | Mensaje reciente muestra el nodo asociado | Aprobada |
| Rotar clave | Acción por nodo y confirmación visible | Aprobada |
| Cerrar sesión | Elimina token y vuelve al login | Aprobada |

Resultados técnicos:

- Frontend: 8/8 pruebas aprobadas y compilación de producción correcta.
- Backend: 41/41 pruebas aprobadas.
- Simulador: 13/13 pruebas aprobadas.
- Firmware: perfiles físicos `node1` y `gateway` compilados, grabados y
  verificados por hash.

Hallazgos corregidos durante la revisión:

- El menú decía “Cambio de rotaciones”; ahora dice “Rotación de claves”.
- “Device ID” ahora se explica como “Identificador del dispositivo”.
- Un sistema sin nodos ya no presenta un uptime ficticio de 99,9 %.
- La grabación selecciona el perfil por MAC y rechaza perfiles incompatibles.
- El canal ESP-NOW se adapta al canal real del hotspot.

## Prueba humana pendiente

La validación automatizada no sustituye observaciones con personas ni permite
calcular un puntaje SUS legítimo. Las cinco sesiones *think-aloud*, sus tiempos
y el cuestionario SUS descritos en `plan_pruebas_usabilidad.md` deben realizarse
con participantes reales. No se generaron datos humanos ficticios.
