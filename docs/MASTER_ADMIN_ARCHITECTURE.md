# Módulo Administrador Maestro

## 1. Arquitectura y flujo de datos

```text
React / MasterAdmin
        │ Bearer JWT (rol=master_admin)
        ▼
Express /api/master-admin
        │ verificarToken + soloAdministrador
        ├── Wi-Fi controller ── AES-256-GCM vault ── SQLite
        │         └── Wi-Fi provisioning adapter ── Gateway /test
        └── Kits controller ── transaction + audit ── SQLite
                          └── Socket/telemetry already present
```

El frontend nunca recibe la contraseña Wi-Fi almacenada. `GET /wifi` solo informa
`passwordConfigured`. Al probar una configuración, el backend recupera el secreto
cifrado únicamente si el SSID coincide. La integración física se desacopla mediante
`WIFI_PROVISIONING_URL`; su contrato es `POST {url}/test` con `{ssid, password,
securityType}` y una respuesta `{connected: boolean, message?: string}`.

El alta de un kit se ejecuta en una transacción: crea el correlativo de SQLite,
genera `KIT-{id}-{CSPRNG}`, almacena su hash para reclamación y una copia cifrada
para el panel, y registra exactamente tres componentes con roles `node_1..node_3`.

## 2. Esquema de base de datos

El módulo amplía las tablas existentes de forma no destructiva:

```sql
wifi_config(
  id PK CHECK(id=1), ssid, password_ciphertext, security_type,
  connection_status, last_tested_at, last_error,
  updated_by FK usuarios, updated_at
)

kits(
  id PK, display_name, gateway_id UNIQUE, gateway_mac UNIQUE,
  claim_code_hash UNIQUE, unique_key_ciphertext,
  owner_user_id FK usuarios, status, notes, created_at, updated_at
)

kit_devices(
  id PK, kit_id FK kits, device_id UNIQUE, mac_address UNIQUE,
  hmac_key, component_role, identifier_type,
  detected_at, detected_transport,
  UNIQUE(kit_id, component_role)
)

admin_audit_log(
  id PK, actor_user_id FK usuarios, action, entity_type,
  entity_id, metadata_json, created_at
)

app_settings(key PK, value, updated_by FK usuarios, updated_at)
usuarios.token_version -- invalida sesiones al cambiar rol, bloqueo o restaurar
```

Reglas de dominio:

- Un kit nuevo contiene un Gateway y tres identificadores de nodo distintos.
- `component_role` impide duplicar Nodo 1, 2 o 3 dentro de un kit.
- `device_id`, `mac_address` y `gateway_id` impiden reutilizar hardware.
- `status` persistido es `active|inactive`; `online` se calcula cuando los tres
  nodos están aprobados y tienen actividad en los últimos 45 segundos.
- El borrado elimina en una transacción solicitudes, registros operativos de nodos,
  componentes y kit; el evento de auditoría permanece.

Para una siguiente migración mayor se recomienda unificar Gateway y Nodo en una tabla
`hardware_components(id, identifier, identifier_type, kind, status)` y usar
`kit_components(kit_id, component_id, role)`. La implementación actual conserva el
esquema productivo para no romper el aprovisionamiento existente.

## 3. API REST

Todas las rutas requieren `Authorization: Bearer <JWT>` y rol actual
`master_admin` verificado contra la base de datos.

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/master-admin/wifi` | Configuración enmascarada y estado |
| PUT | `/api/master-admin/wifi` | Guardar SSID, seguridad y secreto cifrado |
| POST | `/api/master-admin/wifi/test` | Probar credenciales mediante el Gateway |
| POST | `/api/master-admin/wifi/apply` | Aplicar la configuración guardada mediante el Gateway |
| GET | `/api/master-admin/kits?q=&status=` | Listar, buscar y filtrar kits |
| POST | `/api/master-admin/kits` | Crear 1 Gateway + 3 nodos y generar clave |
| GET | `/api/master-admin/kits/:id` | Consultar el detalle |
| PATCH | `/api/master-admin/kits/:id` | Editar estado y notas secundarias |
| DELETE | `/api/master-admin/kits/:id` | Desvincular y eliminar transaccionalmente |
| PATCH | `/api/master-admin/kits/:id/owner` | Asignar, transferir o desvincular propietario |
| GET / PATCH | `/api/master-admin/users`, `/users/:id` | Listar usuarios y cambiar rol o bloqueo |
| GET / POST | `/api/master-admin/access-requests`, `/access-requests/:id/decision` | Resolver solicitudes de acceso |
| GET | `/api/master-admin/device-requests` | Revisar solicitudes de admisión de nodos |
| GET | `/api/master-admin/monitoring` | Estado y última telemetría de nodos |
| GET | `/api/master-admin/audit` | Auditoría administrativa |
| GET / PUT | `/api/master-admin/settings` | Leer y cambiar intervalo de rotación |
| GET | `/api/master-admin/health` | Salud de backend, SQLite y adaptador |
| GET | `/api/master-admin/backup` | Descargar respaldo SQLite consistente |
| POST | `/api/master-admin/backup/restore` | Restaurar respaldo validado (`application/octet-stream`) |

Ejemplo de alta:

```json
{
  "gatewayIdentifier": "GW-PLANTA-01",
  "nodeIdentifiers": ["SN-NODO-001", "SN-NODO-002", "SN-NODO-003"],
  "notes": "Laboratorio principal"
}
```

Respuesta relevante: `{"id": 7, "name": "Kit 7", "uniqueKey":
"KIT-7-...", "components": [...], "status": "active"}`.

## 4. Pantallas y UX

```text
┌───────────────┬─────────────────────────────────────────────────────┐
│ Master Admin  │ Título contextual                  [Crear nuevo kit]│
│               ├─────────────────────────────────────────────────────┤
│ Resumen       │ [Total] [Activos] [En línea]                        │
│ Red Wi-Fi     ├─────────────────────────────────────────────────────┤
│ Kits          │ [Buscar por kit/clave/gateway/nodo] [Estado ▼]      │
│ Asignación    │ [Kit] [Propietario ▼] [Guardar]                     │
│ Usuarios      │ [Buscar] [Rol ▼] [Bloquear / Desbloquear]           │
│ Solicitudes   │ [Acceso] [Dispositivos] [Aprobar / Rechazar]        │
│ Monitoreo     │ [Resumen] [Telemetría] [Eventos recientes]          │
│ Auditoría     │ [Filtrar] [Exportar CSV]                            │
│ Mantenimiento │ [Salud] [Rotación] [Respaldo / Restauración]         │
│               ├─────────────────────────────────────────────────────┤
│ Usuario       │ Kit | Clave | Gateway | 3 nodos | Estado | Acciones │
└───────────────┴─────────────────────────────────────────────────────┘
```

- **Resumen:** postura de seguridad y accesos rápidos.
- **Red Wi-Fi:** formulario a la izquierda; estado actual, última prueba y error a la
  derecha. La contraseña existente se representa como configurada, nunca se revela.
- **Kits:** métricas, búsqueda local, filtro y tabla. Las acciones son copiar,
  ver/editar y eliminar.
- **Crear kit:** modal que hace explícita la regla `1 Gateway + 3 Nodos`.
- **Eliminar:** modal destructivo que exige escribir el nombre exacto del kit.
- **Wi-Fi:** `Guardada` significa persistida; `Prueba exitosa` indica que el Gateway
  aceptó las credenciales en `/test`; `Conectado` exige confirmación de `/apply`.
- **Usuarios:** bloquear o cambiar rol invalida sesiones previas. La cuenta
  `master_admin` no se puede bloquear ni cambiar de rol desde el panel.
- **Transferencia de kit:** revoca solicitudes anteriores y devuelve los nodos a
  estado pendiente para que el nuevo propietario tramite su admisión.
- **Restauración:** requiere un archivo SQLite íntegro, mismo esquema, clave maestra
  compatible y confirmación escrita; todas las sesiones quedan revocadas.
- La disposición se adapta a tableta y móvil; todos los controles tienen etiquetas,
  foco visible y nombres accesibles.

## 5. Seguridad

- Autorización RBAC en servidor; ocultar la UI no se considera una barrera.
- AES-256-GCM con IV aleatorio para contraseña Wi-Fi y clave recuperable de kit.
- `MASTER_ENCRYPTION_KEY` debe ser un secreto de alta entropía, separado de JWT y
  suministrado por un secret manager. El servidor se niega a usar un valor implícito
  en producción.
- Claves de kit generadas con `crypto.randomBytes`, nunca con contador o `Math.random`.
- Se conserva SHA-256 de la clave para la operación de reclamo sin descifrarla.
- Validación por lista permitida de seguridad Wi-Fi y formatos de identificadores.
- Restricciones únicas y transacciones evitan kits parciales o hardware duplicado.
- Auditoría sin secretos para creación, edición, eliminación y pruebas Wi-Fi.
- El registro público crea usuarios básicos. Quienes solicitan herramientas avanzadas
  permanecen pendientes hasta que un administrador apruebe la solicitud.
- El acceso administrativo se verifica con el rol actual en base de datos; la
  versión de sesión permite revocar JWT ya emitidos.
- El adaptador del Gateway usa un secreto independiente, tiempo límite de 10 segundos
  y HTTPS en despliegue. No se incluyen credenciales en URL, logs o eventos.
- Recomendado para producción: MFA para administradores, reautenticación antes del
  borrado, rate limiting, rotación de claves maestras, TLS extremo a extremo y copia
  de seguridad probada de SQLite (o migración a PostgreSQL con KMS).

## 6. Variables de entorno

```text
MASTER_ENCRYPTION_KEY=<32+ bytes aleatorios gestionados como secreto>
WIFI_PROVISIONING_URL=https://gateway-interno.example
WIFI_PROVISIONING_SECRET=<secreto exclusivo del adaptador>
JWT_SECRET=<secreto JWT independiente>
CORS_ORIGIN=https://url-del-frontend.example
```

El adaptador debe aceptar `POST /test` con `{connected, message}` y `POST /apply`
con `{applied, connected, message}`. Sin `WIFI_PROVISIONING_URL`, guardar funciona,
pero probar y aplicar informan que no hay adaptador. Esta integración requiere un
servicio real conectado al Gateway; la web no cambia por sí sola la red del ESP32.

## 7. Crear la cuenta de Administrador Maestro

Desde `backend`, ejecutar `npm run bootstrap-admin`. El script crea una cuenta
independiente con el correo `master.admin@securemesh.local` y muestra una contraseña
aleatoria una sola vez. Se puede definir `MASTER_ADMIN_EMAIL` antes de ejecutarlo
para elegir otro correo. La contraseña se almacena únicamente como hash bcrypt.

La migración convierte los roles `administrador` anteriores en `avanzado` e invalida
sus sesiones. Un índice único impide una segunda cuenta `master_admin`, y el panel
de usuarios sólo permite asignar roles básico y avanzado. El único administrador
maestro no se puede bloquear ni degradar desde ese panel.
