# Plan de pruebas de usabilidad — esp32-security-p2p
Sprint 4

## 1. Objetivo

Evaluar si un usuario sin entrenamiento previo puede operar el dashboard
(gestión de nodos, monitoreo en tiempo real, alertas y rotación de claves)
de forma efectiva, eficiente y sin frustración.

## 2. Participantes

- **Cantidad recomendada:** 5 usuarios piloto (suficiente para detectar ~85%
  de los problemas de usabilidad, según Nielsen).
- **Perfil:** mezcla de al menos 1 persona técnica (backend/redes) y 2-3
  personas sin conocimiento técnico de IoT/seguridad — simula al
  administrador real de una red domótica.
- **Requisito:** no haber visto el sistema antes de la sesión.

## 3. Metodología

Sesiones individuales de ~30 minutos, moderadas, siguiendo el método
*think-aloud* (el usuario narra en voz alta lo que piensa mientras navega).
Se graba pantalla + audio con consentimiento previo.

## 4. Tareas a evaluar

| # | Tarea | Pantalla | Éxito se define como |
|---|---|---|---|
| 1 | Iniciar sesión con las credenciales dadas | Login | Entra al dashboard en ≤2 intentos |
| 2 | Registrar un nuevo nodo ESP32 | Gestión de nodos | Completa el formulario y ve el nodo en la tabla, sin ayuda |
| 3 | Identificar si un nodo está activo o desconectado | Dashboard | Señala el nodo correcto en ≤10 segundos |
| 4 | Bloquear un nodo y explicar qué cree que pasó | Gestión de nodos | Bloquea el nodo correcto y describe el efecto correctamente |
| 5 | Encontrar la alerta más reciente y decir de qué nodo es | Alertas y eventos | Identifica la alerta correcta sin buscar más de 15 segundos |
| 6 | Rotar manualmente la clave de un nodo | Rotación de claves | Ejecuta la acción y entiende que la clave cambió |
| 7 | Cerrar sesión | Cualquiera | Encuentra el botón sin pistas |

## 5. Métricas a capturar

- **Tasa de éxito por tarea:** completada sin ayuda / con ayuda / fallida.
- **Tiempo por tarea** (cronómetro desde que se lee la instrucción).
- **Errores** (clics en el lugar equivocado, confusión sobre terminología
  como "device_id", "estado", "rotación de clave").
- **SUS (System Usability Scale):** cuestionario de 10 preguntas al final
  de la sesión, escala 1-5. Puntaje ≥68 se considera aceptable.
- **Comentarios espontáneos** durante el think-aloud (citas textuales).

## 6. Cuestionario SUS (aplicar tal cual, no traducir la escala)

1. Creo que usaría este sistema con frecuencia.
2. Encontré el sistema innecesariamente complejo.
3. Creo que el sistema fue fácil de usar.
4. Creo que necesitaría ayuda de una persona técnica para usarlo.
5. Las funciones del sistema están bien integradas.
6. Hay demasiada inconsistencia en el sistema.
7. Creo que la mayoría de las personas aprenderían a usarlo rápido.
8. Encontré el sistema muy incómodo de usar.
9. Me sentí muy seguro/a usando el sistema.
10. Necesité aprender muchas cosas antes de poder usarlo.

## 7. Guion de sesión (para el moderador)

1. **Bienvenida (2 min):** explicar que se evalúa el sistema, no al
   usuario; pedir que piense en voz alta; pedir consentimiento de grabación.
2. **Contexto (1 min):** "Imagina que eres responsable de la seguridad de
   una red de sensores ESP32 en una casa inteligente."
3. **Tareas (20 min):** leer cada tarea de la tabla una por una, sin dar
   pistas salvo que el usuario esté completamente bloqueado (>2 min sin
   avanzar); anotar tiempo y ruta que siguió.
4. **Cuestionario SUS (5 min):** aplicar al terminar todas las tareas.
5. **Cierre (2 min):** preguntar "¿qué fue lo más confuso?" y "¿qué le
   agregarías o quitarías?".

## 8. Criterios de éxito del sistema (no del usuario)

- Tasa de éxito global ≥ 80% en las 7 tareas.
- Ningún usuario tarda más de 1 minuto en una tarea individual.
- Puntaje SUS promedio ≥ 68.
- Cero tareas fallidas en la Tarea 1 (login) y Tarea 7 (logout) — son
  bloqueantes por definición si fallan.

## 9. Entregable de la prueba

Una tabla consolidada con los resultados de los 5 usuarios (tiempos,
tasa de éxito, SUS individual y promedio) más una lista priorizada de
hallazgos de usabilidad, clasificados como: **crítico** (bloquea la tarea),
**moderado** (genera confusión pero se completa) o **menor** (estético).
