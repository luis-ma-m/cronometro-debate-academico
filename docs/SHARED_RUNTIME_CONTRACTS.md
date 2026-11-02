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

## Inventario del puente heredado

Implementación documental: `docs/LEGACY_HANDOFF_INVENTORY.md`.

- Se han identificado los lectores y escritores de los hand-offs de participantes y propuestas de ronda.
- Se han inventariado `panelLink.idMap`, los cursores remotos, snapshots base, reconciliaciones pendientes y ACKs de publicación.
- Se ha identificado la outbox durable de IndexedDB y los borradores/operaciones pendientes de actas.
- Se detectó y corrigió que `HomeView` parseaba `ledu-admin-session` directamente: tanto el bootstrap como el pull remoto utilizan ahora `readManagerSession`.
- Los hand-offs y la propuesta de ronda usan claves globales de una sola posición; la migración debe añadir identidad de entrega y ACK de consumo para evitar carreras entre pestañas.
- El store local sigue admitiendo múltiples torneos. No se simplifica hasta que exista exportación, migración y restauración verificables.

**Resultado:** inventario completado; no se ha cambiado el comportamiento ni se ha eliminado o migrado ninguna clave. La siguiente implementación debe centralizar el acceso a sesión y diseñar el repositorio común con compatibilidad v1, dual-read/dual-write y rollback.


## Persistencia común versionada (primer incremento)

Implementación: `src/contracts/applicationPersistence.ts`.

- Define un repositorio común por `namespace/key` con envoltorio versionado, revisión monotónica y timestamp.
- La implementación de navegador usa IndexedDB (`ledu-application-runtime-v1`, object store `records`) con transacciones read-write y compare-and-set por revisión.
- `expectedRevision: null` permite crear solo si el registro no existe; un entero exige que coincida la revisión leída; omitirlo permite una escritura incondicional.
- Incluye una implementación en memoria para tests/adaptadores.
- El adaptador de compatibilidad implementa dual-read/dual-write para un registro heredado: valida el valor antiguo, migra al leer sin borrar v1, detecta divergencias entre v1 y v2 y escribe primero el registro principal antes de intentar el espejo heredado.
- Si falla la escritura espejo, lanza `LegacyMirrorWriteError` con el registro principal ya confirmado. El consumidor debe conservar el mismo registro/revisión y reconciliar; no debe generar otra operación con ID nuevo.
- Los conflictos compare-and-set no sobrescriben una revisión concurrente.

**Límites deliberados de esta entrega:**
- El repositorio aún no está conectado a los flujos de hand-off, outbox manual, mappings, snapshots base, conflictos ni ACKs. No se cambia el comportamiento existente.
- IndexedDB se añade como almacén de runtime independiente; no se modifica ni migra la base `ledu-tabulation-sync-v1` que contiene operaciones pendientes.
- El adaptador dual todavía se aplica por registro y requiere un parser/serializador específico del formato v1. No se debe conectar a una clave real hasta añadir ese adaptador específico y pruebas de recuperación.
- No hay borrado automático de claves v1 ni de datos históricos.

Tests: `src/contracts/applicationPersistence.test.ts` cubre revisiones, compare-and-set, aislamiento JSON, listado, borrado condicionado, migración v1 no destructiva, divergencia y fallo de escritura espejo.

## Siguiente paso arquitectónico

1. [x] Sustituir las lecturas directas de sesión de `HomeView` por `readManagerSession`. La validación está cubierta por `managerSession.test.ts`; verificar CI del nuevo HEAD.
2. Diseñar e implementar el repositorio común de persistencia y los contratos versionados de hand-off, propuesta, mappings, cursor, snapshot base, conflictos y ACKs.
3. Introducir el nuevo formato en paralelo, con dual-read/dual-write verificable y sin limpiar los datos v1.
4. Migrar y probar operaciones pendientes, mappings, snapshots, conflictos y ACKs; mantener rollback al lector v1. La cola de handoff/propuesta/ACK ya está conectada, pero requiere CI y prueba multi-pestaña antes de retirar el bridge.
5. Retirar lectores/escritores heredados solo cuando se demuestre que no quedan consumidores y la restauración esté probada.
6. Abordar la simplificación del índice multi-torneo local en una fase separada, después de exportación y recuperación verificables.

No se deben borrar `HANDOFF_KEY`, `OUTBOX_KEY`, `PANEL_SYNC_BASE_PREFIX`, `PANEL_SYNC_PENDING_PREFIX`, ACKs, mappings ni operaciones IndexedDB durante los pasos anteriores.


## Bandeja común de entregas entre módulos

Implementación: `src/contracts/applicationDeliveryQueue.ts`; persistencia IndexedDB compartida: `src/contracts/applicationPersistence.ts`.

- La base `ledu-application-runtime-v1` evoluciona de versión 1 a versión 2 mediante una actualización IndexedDB no destructiva. Se conserva el object store `records` y se añade `deliveries` con clave primaria `deliveryId` e índices por creación y destino/creación.
- Cada entrega tiene ID estable, origen, destino, tipo, timestamp, payload JSON, estado (`pending`, `claimed`, `acked`) e intentos.
- `enqueue` es idempotente: repetir el mismo ID y contenido devuelve la entrega existente; reutilizar el ID con contenido distinto se rechaza.
- `claimNext` exige el módulo destino (`manager` o `tabulation`) y reclama atómicamente solo entregas dirigidas a ese módulo, pendientes o con lease vencido. El lease identifica al consumidor y tiene duración limitada (máximo cinco minutos).
- Solo el propietario del lease vigente puede confirmar (`acknowledge`); un ACK posterior a la expiración se rechaza. Solo el propietario puede liberar (`release`). Un consumidor distinto no puede confirmar ni liberar el trabajo ajeno.
- Las entregas confirmadas se conservan; no hay purga automática ni borrado de históricos.
- Hay implementación en memoria para tests y una implementación IndexedDB para el navegador.

**Integración funcional:** `sendToTabulation` encola snapshots de participantes; `RoundsView` encola propuestas de ronda; `HomeView` reclama, valida y confirma handoffs solo después de persistirlos localmente; Gestión reclama propuestas, exige revisión humana y las transfiere a su outbox de publicación; `syncDispatcher` guarda ACKs transaccionales en la cola y Tabulación los aplica y confirma tras persistir los mappings. Las claves heredadas siguen como fallback y se limpian solo tras ACK durable. Los IDs de handoff/propuesta son deterministas para el mismo payload.

**Límites y validación pendiente:** los tests actuales ejercitan la cola en memoria; falta prueba real de IndexedDB con dos pestañas, recarga, bloqueo y recuperación. El build de Vercel del HEAD previo detectó errores de TypeScript en las firmas genéricas de la cola y el narrowing del mapa de IDs; corregidos en esta revisión, pendientes de CI. No se debe retirar el bridge heredado hasta validar la ruta completa.
