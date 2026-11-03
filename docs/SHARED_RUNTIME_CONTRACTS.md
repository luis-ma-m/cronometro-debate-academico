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


## Repositorio común del torneo activo (primer corte estructural)

Implementación: `src/contracts/sharedTournamentRepository.ts`.

- Añade un documento compartido versionado (`ledu-shared-tournament-v1`) para el único torneo activo del navegador.
- El documento contiene proyecciones de dominio separadas: `manager` para el modelo de Gestión y `tabulation` para los registros de torneo/índice de Tabulación. No se fuerza una conversión destructiva entre `Tournament` y `TabTournament`; siguen siendo modelos especializados mientras se completa el mapeo canónico de entidades.
- Gestión en modo demostración lee y escribe su proyección compartida, manteniendo `ledu-tournament-demo-v1` como espejo de compatibilidad y recuperación.
- El store de Tabulación hidrata únicamente claves v1 ausentes y refleja las escrituras del índice y del torneo en el mismo documento compartido. Las claves locales existentes tienen prioridad y no se sobrescriben durante la hidratación.
- La actualización de una proyección conserva la otra. Se incrementa una revisión del documento y se mantiene una copia versionada en IndexedDB mediante el repositorio de persistencia común.
- Gestión escucha cambios del documento compartido en otras pestañas y refresca su proyección solo cuando no hay cambios locales pendientes. Tabulación conserva su bloqueo de escritor y su mecanismo de conflicto por revisión.
- Los datos heredados no se eliminan; las copias de seguridad y el registro append-only de Tabulación continúan en sus claves actuales.

**Alcance real y límites:** este es el primer corte de repositorio compartido de runtime en el mismo navegador/origen, no todavía una base de datos relacional única ni sincronización multi-dispositivo. Las proyecciones de Gestión y Tabulación siguen siendo distintas y no se traducen automáticamente todos los equipos, jueces, actas, cruces o clasificaciones. El handoff validado sigue siendo el mecanismo de intercambio de dominio entre ellas. El espejo IndexedDB es best-effort en esta fase; el funcionamiento local-first no depende de que esté disponible. No se ha tocado Neon ni se han ejecutado migraciones.

**Pruebas:** `sharedTournamentRepository.test.ts` verifica que ambas proyecciones conviven, que la hidratación no pisa claves locales existentes, que un documento corrupto se conserva y que la eliminación de una proyección no afecta a las demás.


## Sustitución de proyecciones por repositorio canónico de entidades

La implementación inicial `sharedTournamentRepository.ts` (un objeto con proyección `manager` y un diccionario `tabulation`) queda retirada. La autoridad de persistencia del estado activo en el navegador pasa a `src/contracts/canonicalTournamentRepository.ts`.

### Modelo
- Un único documento versionado (`ledu-canonical-tournament-v2`) contiene un registro normalizado de entidades `team`, `speaker`, `judge` y `venue`, junto con el estado específico de cada módulo que no pertenece a esas entidades.
- Las entidades comunes se indexan por ámbito de torneo, tipo e ID canónico. El registro guarda los IDs de origen de Gestión y Tabulación y sus atributos especializados, además de los campos compartidos.
- Gestión es la fuente preferente para nombre, institución y estado cuando existe un registro de Gestión explícitamente asociado.
- Las relaciones de orador→equipo e incompatibilidades de juez se almacenan usando IDs canónicos y se traducen de vuelta a los IDs locales al reconstruir cada modelo.
- Tabulación solo comparte una entidad con Gestión mediante `panelLink.idMap` explícito. No se infieren equivalencias por nombre, institución, orden ni coincidencia aproximada. Sin mapping, ambas identidades se conservan separadas.
- Las entidades comunes se eliminan de los estados específicos de módulo: esos estados conservan rondas, debates, resultados, papeletas, reglas, configuración y metadatos propios.

### Lecturas y escrituras migradas
- `readDemo`/ `writeDemo` usan el repositorio canónico; el snapshot demo v1 se conserva como fuente de migración/recuperación y deja de recibir dual-writes.
- La carga remota de Gestión escribe el snapshot validado en el repositorio canónico y reconstruye el modelo leído desde él. Los guardados remotos actualizan también la copia canónica local; el servidor sigue siendo autoridad en modo autenticado.
- El adaptador de `useTabStore` intercepta el índice y los registros de torneo para leer/escribir el repositorio canónico. Logs append-only, copias de emergencia y metadatos de operador permanecen en sus claves auxiliares.
- La actualización de la clave canónica notifica a ambos stores mediante eventos de almacenamiento; las revisiones/conflictos y el bloqueo de escritor de Tabulación siguen activos.
- La migración inicial importa el documento compartido anterior, el snapshot demo v1, el índice y los torneos v1. Los bytes legacy no se borran ni se sobrescriben. Los borrados se representan con tombstones para evitar que una clave legacy vuelva a resucitar un torneo.
- IndexedDB recibe una copia durable ordenada del documento canónico. La fachada síncrona local-first sigue siendo necesaria por el contrato síncrono actual de `TabStore`; no se presenta IndexedDB como autoridad transaccional ya migrada.

### Pruebas añadidas
- Unificación por mapping explícito de equipo, orador, juez y venue.
- Precedencia de los campos compartidos de Gestión sin perder extensiones de Tabulación.
- Traducción de relaciones de speaker/team e incompatibilidades por IDs canónicos.
- Rechazo de matching por nombre o por mapping ausente.
- Eliminación de una fuente sin borrar la entidad que sigue perteneciendo al otro módulo.
- Migración no destructiva desde claves legacy y desde el documento compartido anterior.
- Tombstones y preservación de un documento canónico corrupto.

### Límites restantes
- El repositorio normaliza las entidades compartidas principales, pero rondas/debates/asignaciones y resultados siguen en los estados especializados. Su identidad ya tiene contratos, pero falta migrar sus lecturas y relaciones a registros canónicos equivalentes.
- La persistencia local sigue limitada al navegador/origen. No hay sincronización multi-dispositivo nueva ni migración a Neon en este incremento.
- La migración automática no hace matching de participantes sin un mapping explícito. Los registros sin correspondencia permanecen separados hasta que el flujo de vinculación aporte IDs verificables.
