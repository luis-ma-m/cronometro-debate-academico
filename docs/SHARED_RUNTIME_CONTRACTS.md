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

## Snapshot común de participantes

Implementación: `src/contracts/participantSnapshot.ts`.

- DTO versionado `ParticipantSnapshot` con identidad del torneo, revisión y marca temporal.
- Proyecta equipos, oradores, jueces y salas físicas con IDs canónicos y procedencia explícita.
- El adaptador de Gestión usa los IDs de su modelo como IDs canónicos; el adaptador de Tabulación exige mappings explícitos para equipos, oradores, jueces y salas. No hay resolución por nombre.
- Conserva en la proyección compartida los datos comunes necesarios para las relaciones: institución, estado activo, incompatibilidades y relación orador-equipo.
- Valida unicidad de IDs canónicos y referencias entre oradores/equipos/jueces antes de producir el snapshot.
- El parser vuelve a validar los DTOs en los límites entre módulos/persistencia y devuelve una proyección inmutable.
- Los atributos exclusivos de cada módulo (por ejemplo, rating/capacidad de presidencia de jueces, equipos swing, rúbricas, asignaciones y estado del cronómetro) siguen en sus modelos especializados y no se sobrescriben con este DTO.
- Tests: adaptadores de ambos modelos, mappings ausentes, duplicados, relaciones rotas, round-trip y mutaciones.

**Límite:** el snapshot común ya está definido y probado como contrato/adaptador, pero todavía no sustituye el handoff de localStorage ni se inyecta como store/estado común en ambos shells. No se ha hecho migración destructiva ni se han borrado mappings.

## Bootstrap común de aplicación

Implementación: `src/contracts/applicationBootstrap.ts`.

- Reúne sesión validada, contexto del torneo activo y snapshot común de participantes en una única proyección runtime versionada.
- Revalida los tres contratos en el punto de composición.
- Rechaza snapshots de participantes sin contexto activo o cuyo ID canónico de torneo no coincide.
- Gestión construye el snapshot desde su modelo de torneo remoto; Tabulación lo construye desde su modelo local especializado solo cuando dispone del mapping explícito `panelLink.idMap`.
- Ambos shells utilizan el bootstrap como fuente de sesión/contexto para habilitar sus workers de sincronización.
- Una sesión caducada se representa como no disponible; el contexto local/remoto no concede autorización. Cada endpoint sigue verificando el token en servidor.
- Si Tabulación carece de mappings explícitos o la proyección no valida, el bootstrap conserva sesión/contexto pero no publica un snapshot compartido. No se infieren correspondencias ni se muta el torneo local.

**Límite:** el bootstrap se deriva en memoria en cada shell; todavía no existe un proveedor React único, un store común ni una única lectura persistida del torneo. La sesión y los modelos siguen siendo propiedad de cada módulo.

## Alcance y límites

El contrato de sesión elimina la duplicación del formato y de su clave entre los dos shells. El contrato de torneo fija la forma del contexto compartido. **Ninguno de los dos** unifica todavía la autenticación, el ciclo de vida de React, las rutas ni el estado de Gestión y Tabulación.

La sesión continúa almacenada localmente para compatibilidad; el servidor sigue siendo la autoridad de autorización y caducidad. No se debe interpretar la presencia de una sesión local como prueba de autorización. Cada endpoint protegido debe seguir verificando el token en servidor.

El contexto local tampoco debe confundirse con una revisión oficial confirmada. Las escrituras remotas solo se consideran persistidas tras ACK verificable del backend.

## Siguiente paso arquitectónico

1. Inventariar los puntos de entrada que seleccionan/cargan el torneo en Gestión y Tabulación, y sus consumidores.
2. Definir un bootstrap común que resuelva sesión y contexto activo una sola vez.
3. Integrar el snapshot común de participantes en un bootstrap compartido, manteniendo los modelos especializados como propietarios de sus campos.
4. Migrar rutas y shells a ese bootstrap sin cambiar todavía la propiedad de datos de cada módulo.
5. Retirar accesos duplicados a almacenamiento y simplificar el índice local solo después de exportación/backup, migración y pruebas de recuperación.

La aplicación mantiene un único torneo activo por instalación. El ID estable del torneo sigue siendo necesario para integridad, auditoría e idempotencia; no implica soporte multi-torneo.
