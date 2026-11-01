# Contratos compartidos de runtime

## Objetivo

El pivote hacia una sola aplicación requiere eliminar contratos duplicados entre Gestión y Tabulación antes de unificar sus shells. Este documento registra los contratos transversales de runtime que ambos módulos deben adoptar.

## Sesión de Gestión

Implementación: `src/contracts/managerSession.ts`.

- La clave persistida `ledu-admin-session` tiene un único propietario contractual.
- Gestión y Tabulación leen y validan la sesión mediante `readManagerSession`.
- La validación se hace en runtime: token no vacío, longitud máxima de 200 caracteres y caducidad entera estrictamente futura.
- Escritura y borrado pasan por `writeManagerSession` y `clearManagerSession`.
- JSON corrupto, sesiones caducadas y formas inesperadas se tratan como sesión no disponible.
- Los tests cubren parseo, expiración, round-trip, corrupción y borrado.

## Contexto del único torneo activo

Implementación: `src/contracts/activeTournamentContext.ts`.

- `ActiveTournamentContext` identifica el torneo que la instalación está operando; no representa un catálogo ni un selector de torneos.
- El contrato contiene un ID canónico estable, revisión monotónica observada, origen (`server` o `local`) y marca temporal.
- El parser valida en runtime la versión del contrato, el ID opaco, el origen y los enteros seguros no negativos.
- El objeto devuelto es inmutable.
- El origen `local` permite representar un torneo local/demo todavía no vinculado a identidad de servidor. No autoriza por sí mismo a publicar ni sincronizar.
- Los tests cubren contexto local/remoto, inmutabilidad, versiones no soportadas, IDs inválidos, revisiones y timestamps malformados.

**Límite importante:** este incremento define y prueba el contrato, pero todavía no elige el torneo, no persiste el contexto, no lo inyecta en React ni elimina los índices multi-torneo existentes. Esas operaciones requieren inventario y migración compatible de los datos locales.

## Alcance y límites

El contrato de sesión elimina la duplicación del formato y de su clave entre los dos shells. El contrato de torneo fija la forma del contexto compartido. **Ninguno de los dos** unifica todavía la autenticación, el ciclo de vida de React, las rutas ni el estado de Gestión y Tabulación.

La sesión continúa almacenada localmente para compatibilidad; el servidor sigue siendo la autoridad de autorización y caducidad. No se debe interpretar la presencia de una sesión local como prueba de autorización. Cada endpoint protegido debe seguir verificando el token en servidor.

El contexto local tampoco debe confundirse con una revisión oficial confirmada. Las escrituras remotas solo se consideran persistidas tras ACK verificable del backend.

## Siguiente paso arquitectónico

1. Inventariar los puntos de entrada que seleccionan/cargan el torneo en Gestión y Tabulación, y sus consumidores.
2. Definir un bootstrap común que resuelva sesión y contexto activo una sola vez.
3. Adaptar un flujo de lectura de snapshot de participantes con DTO versionado y validación runtime.
4. Migrar rutas y shells a ese bootstrap sin cambiar todavía la propiedad de datos de cada módulo.
5. Retirar accesos duplicados a almacenamiento y simplificar el índice local solo después de exportación/backup, migración y pruebas de recuperación.

La aplicación mantiene un único torneo activo por instalación. El ID estable del torneo sigue siendo necesario para integridad, auditoría e idempotencia; no implica soporte multi-torneo.
