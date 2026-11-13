# Inventario de placas

| Perfil | Rol | Puerto de grabación | MAC | Estado |
| --- | --- | --- | --- | --- |
| `gateway` | Gateway Wi-Fi/ESP-NOW | Se selecciona al grabar | `B0:3F:D3:5B:50:B4` | Listo para grabar |
| `node1` | Nodo `esp32-001` | Se selecciona al grabar | `20:50:0D:17:C8:D0` | Listo para grabar |
| `node2` | Nodo `esp32-002` | Se selecciona al grabar | `38:18:2B:8A:16:6C` | Firmware grabado y hash verificado el 2026-10-15 |
| `node3` | Nodo `esp32-003` | Se selecciona al grabar | `20:50:0D:17:EC:64` | Listo para grabar |

Las claves iniciales, PMK y LMK se encuentran en `main/config.c`. No deben
publicarse ni reutilizarse en otra instalación.

Los puertos COM no identifican una placa y por eso no se guardan aquí: Windows
puede asignar otro número al cambiar el cable o el conector USB. Use
`./flash_profile.ps1` para elegir una conexión disponible: el script lee la MAC
y selecciona el perfil registrado automáticamente. Si indica
`-Profile <perfil>`, se usa únicamente como validación contra la MAC detectada.
