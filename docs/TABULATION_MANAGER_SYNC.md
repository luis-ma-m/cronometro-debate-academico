# Tabulación integrada con el gestor: contrato de sincronización

## Autoridad de datos

- El gestor de debate y su base de datos son la autoridad para equipos, oradores, jueces, instituciones, salas físicas, rondas y asignaciones oficiales.
- Las reglas de tabulación pasan a Configuración del gestor y deben persistirse como parte de la configuración oficial del torneo. La pestaña de reglas local no debe seguir siendo una segunda fuente editable.
- Las actas de tabulación son autoridad cuando se guardan: se deben convertir a la estructura oficial de puntuaciones del gestor y sustituir las puntuaciones/actas de la asignación correspondiente, usando revisión optimista e idempotencia.
- La clasificación que se muestra en el gestor debe ser la clasificación calculada por tabulación, manteniendo la vista predeterminada limitada a cinco equipos/oradores y el control «Ver más».

## Resiliencia

La tabulación siempre abre y trabaja con su copia local. La conexión es opcional. Una petición fallida no debe limpiar el estado local ni las actas; los cambios remotos pendientes deben permanecer en una cola local recuperable. La recuperación vuelve a consultar la revisión oficial antes de intentar reintentos. Nunca se interpretará una respuesta vacía por error como eliminación de entidades.

## Estado de conexión

El indicador consulta el endpoint de salud cada 15 segundos y al recuperar foco/conexión. Un chequeo fallido lo muestra en rojo; se conserva la hora de la última conexión exitosa para mostrar el tiempo transcurrido. Este chequeo indica disponibilidad del servicio de salud, no garantiza por sí solo que una escritura concreta haya sido confirmada.

## Implementación por fases

1. Indicador de salud y mejoras de presentación de clasificación.
2. Persistencia de reglas en el modelo del gestor y traslado de la edición a Configuración.
3. Adaptadores de datos compartidos y reconciliación con IDs estables.
4. Conversión y envío idempotente de actas de tabulación al sistema de puntuaciones del gestor.
5. Cola offline, pruebas de recuperación y pruebas de concurrencia.

La integración de actas requiere mapear expresamente las diferencias entre actas por juez y actas conjuntas de tabulación y el modelo de puntuaciones del gestor; no debe implementarse copiando objetos sin validación.


---

# Especificación técnica ampliada para implementación

> Esta sección amplía el contrato inicial sin sustituirlo. Los cambios descritos aquí son trabajo pendiente salvo los elementos identificados expresamente en la primera entrega de la PR. La PR debe continuar en draft mientras falte cualquiera de los criterios de aceptación.

## 1. Arquitectura existente y límites obligatorios

La integración debe respetar los modelos y responsabilidades actuales:

- Tabulación utiliza \`TabTournament\` (\`src/tabulation/types.ts\`) y almacena sus datos en el navegador mediante \`createTabStore\` (\`src/tabulation/store.ts\`). El store tiene revisión local, control de escritura entre pestañas, backups y log. No sustituirlo por llamadas al servidor.
- El modelo del gestor (\`src/domain.ts\`) utiliza \`Tournament\`, \`Team\`, \`Speaker\`, \`Judge\`, \`Round\`, \`Room\` y \`PhysicalRoom\`.
- El modelo de puntuación del gestor (\`src/scoring.ts\`) es \`ScoringConfig\` con \`RoundScorecard\`, categorías, puntuaciones de equipo, jueces y oradores. Tiene validación de dominio mediante \`validateScorecard\`.
- El backend (\`api/index.ts\`) ya opera con PostgreSQL/Neon y el patrón \`{ ok, data }\` / \`{ ok: false, error }\`. Las escrituras privadas actuales emplean sesión, \`expectedRevision\`, transacción e idempotencia.
- \`GET /api?action=health\` verifica API/configuración, Neon y Redis. No confirma que una sincronización concreta esté pendiente o completada.
- \`src/tabulation/whatsapp.ts\` ya implementa enlaces A1 autocontenidos y códigos ACTA1; el código existente debe mantenerse compatible. La mención a A2 de la propuesta exige inspeccionar y preservar su implementación real antes de tocar codecs.

**No enviar TabTournament a saveTournament ni tratarlo como Tournament.** La integración requiere DTOs específicos, validación runtime en servidor, mapeadores explícitos y persistencia propia. El navegador nunca conecta directamente con Neon o Redis.

## 2. Autoridad por entidad

La autoridad debe definirse por tipo de dato:

| Dato | Autoridad | Comportamiento |
|---|---|---|
| Identidad/nombre del torneo y vínculo | Gestor | Tabulación guarda el ID remoto |
| Equipos, institución, estado, incompatibilidades | Gestor | Réplica local; no crear duplicados |
| Oradores y pertenencia | Gestor | Réplica local; preservar histórico |
| Jueces, institución e incompatibilidades | Gestor | Réplica local |
| Salas físicas | Gestor | Réplica local |
| Rondas y asignaciones oficiales | Gestor | Los sorteos locales permanecen como borrador hasta su publicación/aceptación |
| Reglas de tabulación | Gestor → Configuración | Un único editor autoritativo |
| Actas de tabulación | Tabulación como origen de la propuesta | Solo son oficiales tras validación, confirmación y commit remoto |
| Puntuaciones oficiales | Gestor | Se sustituyen con acción explícita y auditoría |
| Clasificaciones | Motor de Tabulación | Gestor muestra una proyección, no recalcula una versión simplificada |
| Cola y log de sincronización | Cada cliente/servidor para su ámbito | Correlación mediante operationId |

«Las actas de tabulación son autoridad cuando se guardan» significa que una acta validada y confirmada puede sustituir al acta oficial. No significa que un borrador local o cada autosave sobrescriban automáticamente el gestor.

### Edición

- Mover el editor de reglas a **Gestor → Configuración → Reglas de tabulación**.
- Si existe un torneo vinculado, la antigua pestaña local de reglas pasa a modo lectura y muestra revisión y fecha de sincronización; no constituye una segunda fuente editable.
- Las entidades autoritativas se editan en el gestor. Si Tabulación necesita modificar alguna, debe enviar una propuesta explícita que el gestor valide y acepte.
- Una ronda generada localmente no modifica una sala oficial hasta publicarse y ser aceptada.

## 3. Identidad y vinculación inicial

- El ID remoto del gestor es canónico para cada entidad compartida.
- Los IDs actuales de Tabulación no deben regenerarse. Persistir una correspondencia \`localId → remoteId\` con tipo de entidad.
- Nunca fusionar entidades solo por nombre. Una coincidencia normalizada puede sugerirse durante el vínculo inicial, pero las colisiones requieren confirmación humana.
- Renombrar una entidad no cambia su identidad.
- Desactivar o eliminar una entidad no borra actas/rondas históricas que la referencian. Mantener tombstone o estado inactivo.
- Antes de activar el vínculo, mostrar resumen de coincidencias, duplicados y entidades sin correspondencia. No ejecutar un merge destructivo automático.

Flujo:
1. Autenticar al operador en el gestor y seleccionar el torneo remoto.
2. Leer snapshot completo con \`tournamentId\`, \`revision\`, \`settingsRevision\` y \`updatedAt\`.
3. Comparar entidades locales/remotas usando IDs conocidos y sugerencias por nombre/institución.
4. Resolver manualmente cualquier ambigüedad.
5. Guardar vínculo y mapa de IDs local.
6. Importar snapshot como base, preservando datos que solo existan localmente y actas locales sin enviar.
7. Mostrar resultado de importación y conflictos pendientes.

## 4. Persistencia de reglas

Guardar el documento de reglas como entidad versionada por torneo, no como estado efímero del frontend:

\`\`\`ts
type PersistedTabulationSettings = {
  schemaVersion: number;
  tournamentId: string;
  revision: number;
  settings: TabSettings;
  updatedAt: number;
  updatedBy: string;
};
\`\`\`

- Persistir \`TabSettings\` completo y la rúbrica completa con IDs estables, nombres, secciones y descripciones.
- No persistir \`outcomes\`, rankings ni standings como fuente de verdad: son derivados de rondas y actas.
- Añadir una migración SQL versionada y no destructiva. Nunca modificar migraciones ya aplicadas.
- Para instalaciones antiguas sin reglas, aplicar un preset por defecto explícito y registrar qué preset se aplicó.
- Validar enum, rangos, IDs de rúbrica únicos, límites, reglas incompatibles y tamaño del payload en backend.
- Guardar settings, revisión global y evento de auditoría en la misma transacción.
- Los clientes con versión de esquema superior a la que entienden deben entrar en modo lectura y no volver a guardar datos normalizados parcialmente.
- Si una regla cambia cómo se interpretan las actas ya guardadas, preservar snapshot de reglas aplicado a cada ronda/acta o bloquear el cambio con explicación. No reinterpretar silenciosamente el histórico.

UI requerida en Configuración: formato (grupos/suizo), rondas, eliminatorias, paneles, jueces, actas, puntuaciones, sanciones, desempates, oradores, rúbrica y parámetros compartidos relevantes. Aplicar presets con confirmación y snapshot/backup lógico de la versión previa.

## 5. Contrato de API pendiente

Las acciones siguientes son nuevas; no asumir que ya están implementadas:

| Acción | Método | Seguridad | Propósito |
|---|---|---|---|
| \`getTabulationSnapshot\` | POST | Sesión privada | Leer entidades, reglas y revisiones |
| \`saveTabulationSettings\` | POST | Sesión privada | Persistir reglas |
| \`publishTabulationRound\` | POST | Sesión privada | Publicar borrador/resultado de sorteo |
| \`saveTabulationActa\` | POST | Sesión privada | Crear o sustituir acta oficial desde propuesta validada |
| \`getTabulationStandings\` | POST | Sesión privada o token público limitado | Leer proyección calculada |
| \`createActaShortLink\` | POST | Sesión/permiso de creación | Crear enlace corto y snapshot |
| \`resolveActaShortLink\` | GET o POST | Público limitado por token | Resolver snapshot mínimo |
| \`revokeActaShortLink\` | POST | Sesión privada | Revocar enlace enviado incorrectamente |

Se pueden implementar como nuevas acciones del dispatcher de \`api/index.ts\`, pero deben quedar en servicios separados y contratos tipados. Todas mantienen el wrapper actual.

DTO orientativo:

\`\`\`ts
type TabulationSnapshot = {
  tournamentId: string;
  revision: number;
  settingsRevision: number;
  updatedAt: number;
  settings: TabSettings;
  teams: TabTeam[];
  speakers: TabSpeaker[];
  judges: TabJudge[];
  venues: TabVenue[];
  rounds: TabRound[];
  assignments: Array<{
    debateId: string;
    roundId: string;
    roomId: string;
    teamIds: [string, string];
    venueId: string;
    judgeIds: string[];
    chairId: string;
  }>;
  idMapVersion: number;
};
\`\`\`

Los DTOs deben pasar por validación runtime (Zod si ya está disponible o validadores del proyecto), tanto al leer como al escribir. No hacer cast de payload sin validarlo.

Códigos de error mínimos:
\`UNAUTHORIZED\`, \`NOT_CONFIGURED\`, \`NOT_FOUND\`, \`INVALID_PAYLOAD\`, \`INVALID_RELATION\`, \`REVISION_CONFLICT\`, \`ACTA_EXISTS\`, \`ACTA_INVALID\`, \`IDEMPOTENCY_MISMATCH\`, \`LINK_REVOKED\`, \`LINK_EXPIRED\`, \`RATE_LIMITED\`, \`INTERNAL_ERROR\`.

## 6. Reconciliación y sincronización

### Pull remoto

1. Solicitar snapshot con la revisión confirmada local.
2. Distinguir explícitamente «sin cambios» de una colección vacía real.
3. Si hay nueva revisión, calcular diff por ID estable.
4. Clasificar: alta, modificación, desactivación/tombstone, conflicto de edición local y cambio incompatible.
5. Aplicar automáticamente cambios autoritativos solo si no pisan una edición local pendiente.
6. Mantener ambas versiones ante conflicto y presentar diff.
7. Guardar el snapshot y revisión solo tras aplicar atómicamente la actualización local.

Una respuesta vacía por timeout, error de parseo, 401, 409 o 5xx nunca significa que haya que limpiar entidades.

### Push remoto

Cada operación debe incluir:
- \`operationId\` aleatorio y persistente;
- \`tournamentId\`;
- \`entityType\`, \`entityId\`;
- \`operation\` y payload;
- \`baseRevision\`;
- \`payloadHash\`;
- \`createdAt\`.

El backend vuelve a validar relaciones, permisos y reglas. Confirmar la operación solo cuando haya respuesta satisfactoria con revisión persistida o cuando una consulta de idempotencia demuestre el commit. Ante timeout ambiguo, conservar la operación y reintentar con el mismo ID.

### Conflictos

No usar last-write-wins para reglas, actas, puntuaciones, rondas o asignaciones. Para 409, recargar snapshot, mostrar diferencias y pedir decisión. No reintentar sustituciones de actas a ciegas.

## 7. Cola offline duradera

No reemplazar el \`TabStore\` local. Añadir un outbox independiente, preferiblemente en IndexedDB por transacciones y capacidad. Si se usa localStorage, justificarlo con pruebas de cuota y atomicidad.

\`\`\`ts
type PendingSyncOperation = {
  operationId: string;
  tournamentId: string;
  entityType: string;
  entityId: string;
  operation: 'upsert' | 'publish-round' | 'replace-acta' | 'settings';
  baseRevision: number;
  payload: unknown;
  payloadHash: string;
  status: 'pending' | 'sending' | 'conflict' | 'failed';
  attempts: number;
  createdAt: number;
  lastAttemptAt?: number;
  lastError?: { code: string; message: string };
};
\`\`\`

Reglas:
- Persistir primero la edición local y la operación de outbox, antes de petición HTTP.
- Un worker por torneo/cliente; respetar dependencias (entidad antes que referencia, ronda antes que actas).
- Coalescer solo upserts pendientes de una misma entidad. No coalescer actas, reglas ni operaciones auditables.
- Reintentos exponenciales con jitter, límite máximo y respeto a Retry-After.
- 4xx semántico queda para intervención; 401 requiere recuperar sesión; 409 queda como conflicto; red/timeout/5xx son recuperables.
- Al recargar, una operación en estado sending vuelve a pending, salvo que se confirme por idempotencia que ya se guardó.
- Un conflicto bloquea su cadena dependiente, pero nunca bloquea la edición local general.

Estados UI distintos:
- Guardado localmente.
- Pendiente de sincronizar.
- Sincronizando.
- Sincronizado (incluye revisión remota confirmada).
- Conflicto.
- Error recuperable.
- Error que requiere intervención.

No afirmar «sincronizado» porque el endpoint health responda 200.

## 8. Conversión y sustitución de actas

### Incompatibilidades reales entre modelos

Tabulación admite dos modalidades:
- \`ballotMode: 'judges'\`: varias papeletas, una por juez, con puntuaciones, votos derivados y notas.
- \`ballotMode: 'joint'\`: acta conjunta con ganador declarado, rúbrica/ítems, totales, sanciones y puntuaciones de oradores.

El gestor tiene \`RoundScorecard\` con una única puntuación agregada por equipo, categorías, faltas, jueces y hasta ocho puntuaciones de oradores. La estructura actual no conserva las papeletas individuales ni representa de forma directa ganador declarado/rúbrica conjunta. Además, la validación actual del gestor no permite scorecards en rondas eliminatorias.

Por tanto, no basta con mapear campos de forma mecánica:

- En modo judges, acordar regla explícita para agregar las papeletas a la puntuación única (media, descarte de extremos u otra regla del reglamento) y conservar el detalle por juez como origen auditado. Si se exige mantener todas las papeletas, ampliar el modelo backend con tabla de papeletas; no descartarlas.
- En modo joint, definir el mapeo de cada ítem de rúbrica a categoría y cómo representar ganador declarado. Guardar el payload fuente y su snapshot de reglas, ya que \`RoundScorecard\` por sí solo pierde esos datos.
- En eliminatorias, no introducir una puntuación de clasificatoria artificial. Añadir un modelo explícito de ganador/avance o mantener el resultado en Tabulación hasta que el backend soporte eliminatorias.

### Mapeador puro

Crear por ejemplo \`src/tabulation/manager-mapping.ts\` con:
- \`validateActaForManager(...): ValidationIssue[]\`;
- \`toManagerScorecard(...): ConversionResult\`;
- \`compareActaWithManagerScorecard(...): ActaDiff\`.

Validar antes de ofrecer «Sustituir»:
1. Debate vinculado a asignación/ronda existente.
2. Ronda clasificatoria si el destino es scorecard.
3. Mismo par de equipos y misma sala/ronda.
4. Jueces exactos según asignación oficial.
5. Oradores existentes, de uno de los dos equipos, con máximo ocho entradas y posiciones válidas.
6. Categorías conocidas, valores permitidos y sumatorios consistentes.
7. Faltas enteras no negativas.
8. Reglas de penalización sin doble descuento.
9. Revisión remota coincidente.

No redondear, cambiar de escala, descontar faltas ni agregar papeletas sin una regla documentada y pruebas.

### Flujo obligatorio de sustitución

1. Guardar la acta local como siempre.
2. Construir una propuesta de conversión y validarla.
3. Mostrar valores oficiales actuales y propuesta, con diferencias por equipo/categoría/faltas/jueces/oradores.
4. Explicar que sustituir reemplaza la scorecard completa de esa asignación.
5. Pedir confirmación explícita.
6. Enviar operationId, expectedRevision, hash/updatedAt previo y payload convertido.
7. El servidor revalida y escribe puntuación, procedencia, auditoría e idempotencia en una misma transacción.
8. Devolver valores canónicos y revisión nueva.
9. Marcar como sincronizada únicamente tras commit confirmado.

Si el registro cambió desde la comparación, devolver 409, recargar, reconstruir la comparación y pedir confirmación de nuevo. Cancelar no modifica la puntuación oficial.

### Persistir procedencia

Añadir tabla versionada, por ejemplo \`tabulation_acta_sources\`, con:
\`id\`, \`tournament_id\`, \`assignment_id\`, \`scorecard_id\`, \`source_mode\`, \`source_revision\`, \`source_hash\`, \`source_payload\` JSONB, \`operation_id\`, \`created_at\`, \`created_by\`, \`supersedes_source_id\`.

Ajustar claves foráneas a las tablas reales. Mantener historial de sustituciones y conservar las papeletas individuales de modo judges y el detalle de joint cuando corresponda.

## 9. Clasificación dentro del gestor

- Fuente de cálculo única: motor de Tabulación (\`computeTournamentOutcomes\`, \`buildTeamStandings\`, \`buildSpeakerStandings\`).
- Publicar proyección con torneo, revisión fuente, momento de cálculo, versión de reglas y filas.
- Gestor muestra cinco primeros equipos y cinco oradores por defecto; «Ver más» y «Ver menos» muestran el conjunto completo.
- No recalcular rankings en el gestor con lógica reducida.
- Invalidar/recalcular si cambia acta, ronda, sanciones, equipos, configuración o cualquier input relevante.
- En modo a ciegas, respetar los límites de proyección; no filtrar posiciones no publicables.
- Preservar desempates, swing, equipos caídos, rondas silenciosas y reglas de oradores.
- Si la proyección está atrasada, mostrar su revisión/fecha y estado obsoleto.

## 10. Enlaces A1/A2 y enlaces cortos de ocho caracteres

### Compatibilidad

- A1 autocontenido existe en \`src/tabulation/whatsapp.ts\`. Transporta snapshot comprimido en el hash del enlace y utiliza código ACTA1 para la respuesta.
- La especificación de la PR cita A2 como formato autocontenido. Verificar el código real de A2 antes de tocar patrones o codecs.
- A1/A2 históricos seguirán funcionando sin backend. El formato corto es una nueva ruta paralela, nunca reemplazo destructivo.

### Diseño del short ID

- Exactamente ocho caracteres.
- Usar Crockford Base32 sin caracteres ambiguos; si se excluyen 0/1 se mantiene alfabeto de 32 símbolos alternativos.
- Generar exclusivamente con CSPRNG en servidor (\`crypto.randomBytes\`).
- Índice/PK UNIQUE en Neon. Ante colisión generar otro ID; nunca sobrescribir.
- No secuencial ni derivado de IDs internos.
- Es un bearer token: cualquiera que lo tenga podrá consultar el snapshot, por tanto el payload público debe limitarse a un único debate.
- Hash criptográfico del snapshot calculado por servidor. No usar checksum no criptográfico como autenticación.

### Snapshot público

Almacenar snapshot suficiente para reconstruir el formulario incluso si cambian posteriormente reglas o participantes:
- versión del formato;
- IDs opacos de torneo/ronda/debate;
- nombres de torneo/ronda/sala y equipos;
- miembros de los dos equipos;
- jurado/presidencia solo si la interfaz lo necesita;
- reglas y rúbrica exactas vigentes al crear el link;
- deskPhone solo si está configurado y autorizado;
- hash, createdAt, expiresAt opcional, revokedAt.

No incluir credenciales, token de sesión, notas privadas, otros debates ni datos internos del torneo.

### Creación online

1. Cliente construye snapshot desde revisión confirmada.
2. Envía createActaShortLink con operationId, payloadHash, IDs de debate/torneo y revisión.
3. Backend valida sesión, permisos, relaciones y tamaño.
4. Genera el ID y lo inserta; la operación es idempotente.
5. Devuelve link corto y estado.
6. Ante timeout ambiguo, consultar operationId antes de crear un segundo link.

### Resolución

1. Ruta \`/acta\` reconoce short ID además de A1/A2.
2. Resuelve mediante endpoint público rate-limited.
3. Backend valida formato, expiración/revocación y responde solo con snapshot público.
4. Cliente valida schema/version/hash y utiliza el formulario existente.
5. Fallo de red presenta error recuperable con reintentar. No borra borradores del juez.

### Fallback A2

- Intentar link corto cuando el servicio esté disponible, pero no fiarse solo de health: la creación real puede fallar después.
- Si creación falla por offline, timeout, backend no configurado o 5xx, construir A2 enteramente en cliente.
- El fallback no debe requerir llamada al servidor ni invalidar datos locales.
- UX recomendada: compartir enlace corto como principal y A2 como alternativa secundaria en el mismo WhatsApp cuando la longitud sea aceptable. Si solo se comparte el corto, advertir que no se podrá resolver durante una caída del servidor.
- Un short link ya enviado no puede recuperarse offline; el A2 alternativo enviado/guardado es la única alternativa.
- La respuesta del juez por WhatsApp debe seguir siendo independiente del backend.

### Tabla y seguridad

Migración SQL orientativa (ajustar FKs a esquema actual):
\`\`\`sql
CREATE TABLE acta_short_links (
  id char(8) PRIMARY KEY,
  format_version integer NOT NULL,
  tournament_id text NOT NULL,
  debate_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  operation_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX acta_short_links_debate_idx
  ON acta_short_links (tournament_id, debate_id, created_at DESC);
\`\`\`

- Aplicar rate limit por IP e ID y límites estrictos de tamaño/estructura.
- Respuestas uniformes para ID desconocido/revocado/expirado cuando sea necesario evitar enumeración.
- No renderizar contenido como HTML. TLS, nosniff y política de caché no-store para resolver.
- Revocación disponible a la mesa. Revocar el enlace no borra una acta ya recibida.
- operationId repetido con distinto hash devuelve IDEMPOTENCY_MISMATCH.

## 11. Health frente a sincronización

Mantener el chequeo actual cada 15 segundos y al recuperar foco/conexión, pero corregir la semántica visual:
- «API disponible» significa que API, Neon y Redis respondieron al health.
- «Sin conexión con servidor» significa que el health falló.
- Mostrar última comprobación correcta.
- Mostrar por separado revisión remota confirmada y estado de cola.
- Nunca decir «Gestor y base de datos conectados» como equivalente de sincronización completada.
- El health no bloquea Tabulación ni las escrituras locales.
- Añadir timeout, evitar chequeos solapados, ignorar respuestas antiguas y limpiar listeners/intervalos al desmontar. Reducir polling cuando document esté oculto.

## 12. Auditoría, seguridad y privacidad

- Las acciones privadas requieren sesión y autorización para el torneo objetivo.
- Resolver short link es la única acción pública y entrega payload mínimo.
- Nunca exponer NEON_DATABASE_URL, credenciales Redis, ADMIN_PASSWORD o tokens.
- Validar en servidor IDs, referencias, esquema, rangos y permisos.
- Toda sustitución de acta, cambio de reglas y publicación de ronda registra actor, operationId, instante, origen, revisiones antes/después, hash y referencia.
- No incluir payload íntegro ni teléfonos en logs técnicos; enmascarar datos personales.
- Mantener historial de sustituciones en tablas de procedencia, no solo en notas.

## 13. Plan de implementación

### Fase 0 — Consolidar primera entrega
- Mantener indicador y vista de cinco primeros.
- Corregir copy de health para que no sugiera sincronización.
- Añadir tests de polling, online/focus, timeout y cleanup.
- No modificar el almacenamiento local existente.

### Fase 1 — Contratos y persistencia de reglas
- DTOs runtime-validated y schemaVersion.
- Migración Neon para reglas de Tabulación.
- Lectura/escritura transaccional con revisión e idempotencia.
- Editor en Gestor → Configuración; reglas locales en lectura.

### Fase 2 — Vínculo/importación
- Selección de torneo, matching con IDs y resolución manual de colisiones.
- Persistencia de remoteId/idMap/revisión confirmada.
- Importación no destructiva.

### Fase 3 — Reconciliación y offline
- Outbox IndexedDB.
- Pull incremental, push de operaciones permitidas, conflictos por revisión.
- Publicación explícita de rondas.
- Recuperación tras reload/cierre/timeout.

### Fase 4 — Actas oficiales
- Cerrar decisiones sobre papeletas por juez, joint y eliminatorias.
- Ampliar esquema para conservar procedencia.
- Mapeador puro, diff previo, confirmación, sustitución atómica, auditoría.
- Tests de reintentos y concurrencia.

### Fase 5 — Clasificación del gestor
- Proyección desde motor único.
- Cinco filas + Ver más.
- Invalidación por revisión de inputs y modo ciego.

### Fase 6 — Enlaces cortos
- Inspeccionar/confirmar implementación A2 real.
- Migración, create/resolve/revoke, CSPRNG, rate limit.
- Router A1/A2/short.
- WhatsApp corto principal + A2 alternativo.

### Fase 7 — Estabilización
- Integración Neon aislada, pruebas E2E y multi-dispositivo.
- Preview con base independiente de Production.
- Rollback planificado.
- Mantener draft hasta pruebas completas; no migrar Production ni hacer merge durante esta ampliación documental.

## 14. Criterios de aceptación

### Reglas y entidades
- [ ] Configuración persiste y recupera reglas, rúbrica, schemaVersion y revisión.
- [ ] Revisión antigua devuelve conflicto y no sobrescribe.
- [ ] Primera vinculación no duplica entidades y requiere resolver colisiones.
- [ ] Renombrar conserva IDs; desactivar conserva histórico.
- [ ] Respuestas fallidas/vacías no limpian datos locales.
- [ ] Borrados se procesan solo mediante tombstone explícito.

### Offline
- [ ] Con servidor caído se puede abrir torneo, editar, guardar local y registrar actas.
- [ ] Outbox sobrevive recarga y cierre/reapertura.
- [ ] Timeout tras commit no duplica.
- [ ] 409 queda pendiente como conflicto.
- [ ] Al reconectar, cola respeta dependencias y confirma revisión.
- [ ] No existen dos workers simultáneos para el mismo torneo en una misma instalación.

### Actas
- [ ] Modo judges conserva cada papeleta o cuenta con regla de agregación aprobada.
- [ ] Joint conserva rúbrica/ganador como procedencia y aplica mapeo documentado.
- [ ] Eliminatorias no se convierten falsamente en puntuación clasificatoria.
- [ ] Se rechazan equipos/jueces/oradores/ronda incoherentes.
- [ ] Sustitución compara datos y solicita confirmación.
- [ ] Cancelar no toca acta oficial.
- [ ] Conflicto de revisión requiere nueva comparación.
- [ ] Idempotencia devuelve commit previo y no duplica.
- [ ] Auditoría de sustitución completa.

### Clasificación
- [ ] Cinco equipos y cinco oradores por defecto.
- [ ] Ver más/menos presenta listado completo.
- [ ] Resultado coincide con motor Tabulación para grupos, suizo, empates, sanciones, caídos y modo ciego.
- [ ] Cambios relevantes invalidan proyección.

### Enlaces
- [ ] Short ID tiene exactamente ocho caracteres.
- [ ] Colisión concurrente no sobrescribe registros.
- [ ] Online create/resolve funciona con snapshot persistente.
- [ ] Fallo de API/Neon al crear crea A2 offline.
- [ ] Short link enviado durante caída muestra error recuperable; no se presenta como offline-capable.
- [ ] A2 alternativo funciona sin servidor.
- [ ] A1/A2 históricos siguen abriendo.
- [ ] Revocado, expirado, corrupto, rate limit y reintentos están probados.

### Calidad/rollout
- [ ] Typecheck, lint, test y build pasan.
- [ ] Tests Neon aislados cubren rollback, constraints e idempotencia/concurrencia.
- [ ] E2E incluye vínculo, offline, recuperación, sustitución y WhatsApp.
- [ ] Preview usa base separada de Production.
- [ ] No hay regresiones del gestor ni cronómetros.

## 15. Riesgos que bloquean el cierre

1. El gestor solo persiste una scorecard agregada por asignación; las papeletas individuales no caben en ella.
2. La acta conjunta tiene ganador y rúbrica por ítem que el scorecard actual no expresa directamente.
3. Las scorecards actuales no admiten rondas eliminatorias.
4. Debe acordarse cuándo un sorteo local se convierte en asignación oficial.
5. Debe verificarse el formato A2 real antes de dar por cerrada la compatibilidad.
6. Los short IDs de ocho caracteres son tokens bearer y requieren protección frente a enumeración y abuso.

Se puede avanzar en infraestructura y UI mientras se resuelven estos puntos, pero no se debe marcar como terminada la integración de actas hasta cerrar los tres primeros.

## 16. Definición de terminado

La integración solo está terminada cuando hay identidad/reconciliación estable, reglas en Configuración, cola offline recuperable, conversión y sustitución de actas con trazabilidad, clasificación coherente, enlaces cortos con fallback y compatibilidad histórica A1/A2, y todas las pruebas CI/Neon aislado/Preview aprobadas. La primera entrega de esta PR permanece intacta y la PR no se fusiona mientras falte cualquiera de estas condiciones.


## Implementación incremental: identidad canónica del torneo (migración 0011)

La migración `0011_tournament_identity.sql` introduce un UUID generado y persistido en PostgreSQL para identificar el torneo actualmente gestionado. La identidad:

- No se deriva del nombre del torneo ni de IDs locales del navegador.
- Se conserva al renombrar el torneo, editar entidades, recargar la aplicación o desplegar una nueva versión.
- Se expone como `Tournament.remoteId` en el snapshot autenticado del gestor.
- Se vincula mediante FK tanto a `tournament_settings` como a `tabulation_settings`.
- Sustituye el sentinel histórico `default` de las versiones de reglas por el UUID canónico, preservando las versiones y respuestas idempotentes existentes.

**Límite deliberado:** el gestor sigue siendo un singleton (`tournament_settings.id = 1`). Este UUID identifica ese único torneo persistido; no convierte la aplicación en multi-torneo ni autoriza a asociar datos locales por nombre. La rotación de identidad para iniciar un torneo distinto requiere un flujo explícito de ciclo de vida, con comprobación de dependencias e historial, que todavía no se implementa. No se debe reutilizar esta identidad para una nueva competición solo por cambiar el nombre.

La migración no se ha ejecutado en ninguna base de datos. Antes de aplicarla debe demostrarse que el entorno Preview utiliza una rama Neon aislada de Production. Hasta entonces, los endpoints que necesitan la nueva columna informan de migración pendiente y no alteran datos.


## Incremento: identidad remota en el hand-off local

El hand-off versionado del panel incluye ahora `tournamentId` cuando el gestor dispone de la identidad canónica. Tabulación persiste esa identidad en `panelLink.remoteId` y la conserva al normalizar/recargar copias locales.

Reglas de seguridad aplicadas:

- Un torneo ya vinculado solo acepta hand-offs con el mismo UUID remoto. Una identidad distinta bloquea toda la operación antes de modificar equipos, oradores, jueces o salas.
- Un torneo local sin vínculo no se fusiona automáticamente con un torneo remoto, aunque coincidan los nombres o algunos IDs. Se exige crear una copia nueva desde el hand-off autenticado; el torneo local anterior permanece intacto.
- Los vínculos antiguos que solo contienen nombre no se elevan silenciosamente a una identidad remota.
- Los hand-offs legacy/demo sin UUID conservan compatibilidad con el comportamiento anterior.

**Incremento implementado — revisión inicial de identidad:**
- La pantalla de inicio ofrece «Vincular torneo existente con revisión» cuando hay un torneo local sin vínculo y llega un hand-off con UUID remoto.
- La revisión permite mapear manualmente equipos, oradores, jueces y salas; las sugerencias por ID/nombre/institución son orientativas y nunca se aceptan automáticamente.
- Las entidades que se dejan como «Crear nueva» reciben IDs locales nuevos; no se reutilizan IDs remotos como IDs locales por coincidencia accidental.
- Se persiste `panelLink.idMap` con la dirección `localId → remoteId`; se conservan los IDs locales y se traducen también las referencias entre equipos, oradores y jueces.
- El hand-off incluye `revision` y `updatedAt`; Tabulación persiste la última versión aplicada y rechaza snapshots más antiguos o sin metadatos suficientes para comparar.
- Se bloquean IDs inexistentes, asignaciones remotas duplicadas y vínculos de oradores que cambiarían de equipo. La operación completa se valida antes de guardar y crea una copia de seguridad local.
- Las entidades locales no emparejadas, rondas y actas no se eliminan. No se publica ninguna ronda como efecto secundario de vincular.

**Trabajo pendiente:** este primer flujo revisa el hand-off compartido por el panel actual; todavía no implementa la selección/autenticación independiente de un torneo remoto ni la lectura de un snapshot API completo. El hand-off actual no incluye `settingsRevision`, por lo que aún no puede detectar de forma independiente cambios en las reglas persistidas. Tampoco completa la reconciliación histórica de entidades eliminadas/tombstones. Hasta cerrar esos pasos, la vinculación y sincronización integral siguen incompletas.


## Incremento: publicación segura de propuestas de ronda desde Tabulación

La propuesta local de ronda que se envía al gestor incluye, cuando el torneo está vinculado, la identidad canónica del torneo y la revisión/fecha base del snapshot remoto utilizado para generarla.

- Antes de construir la propuesta, Tabulación traduce los IDs locales de equipos, jueces y salas físicas a sus IDs canónicos del gestor mediante `panelLink.idMap`.
- Si falta una correspondencia para cualquier entidad utilizada, la propuesta no se genera. No se envían IDs locales suponiendo que coinciden con los del gestor.
- El payload incluye `tournamentId`, `basePanelRevision` y `basePanelUpdatedAt`.
- El gestor rechaza una propuesta cuya identidad no coincida, que no tenga revisión base verificable o cuya revisión/fecha haya cambiado desde el snapshot.
- Las propuestas legacy sin identidad siguen funcionando únicamente contra torneos legacy sin identidad; no pueden aplicarse a un torneo que ya tenga UUID canónico.
- Esta comprobación es una precondición para la revisión/publicación: no publica ni guarda asignaciones automáticamente. El operador todavía debe revisar la propuesta, confirmarla y guardar los cambios desde el gestor.

Este control evita aplicar cruces a otro torneo o sobre una revisión que cambió después de generar el sorteo. No sustituye la futura publicación remota transaccional ni la reconciliación multi-dispositivo.


## Incremento: infraestructura de outbox local duradera

Se añade `src/tabulation/syncOutbox.ts` como infraestructura independiente del `TabStore` y de `localStorage`:

- Persistencia en IndexedDB (`ledu-tabulation-sync-v1`), separada de los datos de torneo y de las copias de seguridad existentes.
- Sobre de operación con `operationId`, `tournamentId`, tipo/ID de entidad, operación, `baseRevision`, payload, hash SHA-256, estado, intentos y marcas de tiempo.
- Serialización JSON determinista para calcular el hash; se rechazan payloads no serializables o superiores a 1 MB.
- Claim atómico en transacción read-write de IndexedDB: solo se entrega la operación pendiente más antigua de cada torneo. Una operación en conflicto o fallida bloquea las posteriores de ese torneo, no las de otros torneos.
- Lease temporal y `workerId` para evitar que otra pestaña complete o libere una operación reclamada por un worker distinto. Los leases expirados pueden recuperarse sin robar operaciones activas.
- Los reintentos conservan el mismo `operationId` y hash. La operación solo se elimina mediante `acknowledge`, que exige el worker propietario; el adaptador futuro deberá llamarlo exclusivamente tras confirmar el commit remoto o consultar idempotencia.
- Los conflictos (`REVISION_CONFLICT`) y errores semánticos permanecen en cola para intervención; no hay política last-write-wins.

**Límite deliberado de esta entrega:** esta es la capa de almacenamiento y ciclo de vida de la cola, no un sincronizador remoto completo. Todavía no está conectada a las ediciones de actas, reglas o rondas; no hay worker HTTP, endpoint de publicación ni UI de estados. Por tanto, no se encolan ni se transmiten operaciones automáticamente y no debe mostrarse «sincronizado». Tampoco se implementan aún coalescing de upserts ni dependencias entre entidades. Esos pasos requieren contratos de API y validación de servidor antes de activar el envío.


## Incremento: contrato de transporte validado para operaciones de sincronización

Se añade `api/sync-operation-validation.ts` como frontera de validación del sobre que enviará la outbox al servidor. El contrato de transporte versión 1 exige:

- `operationId` estable (8–128 caracteres permitidos), UUID canónico `tournamentId`, tipo/ID de entidad y revisión base entera no negativa.
- Operación explícita entre `upsert`, `publish-round`, `replace-acta` y `settings`. Se comprueba que publicación de ronda, sustitución de acta y configuración apunten a su tipo de entidad correspondiente.
- Payload JSON objeto, máximo 1 MB, sin coerciones silenciosas ni tipos no JSON.
- Hash SHA-256 recalculado en servidor sobre JSON canónico con claves ordenadas. El servidor rechaza cualquier discrepancia entre payload y hash.
- Canonicalización segura de claves especiales como `__proto__`; no se muta ni se interpreta el contenido como configuración de objetos.

Se añaden pruebas para protocolo/versiones, UUID, IDs, revisiones, pares operación-entidad, hash alterado, payload no JSON, tamaño y claves especiales.

**Límite deliberado:** esto valida únicamente el sobre de transporte. No autentica sesión, no comprueba permisos/relaciones de dominio, no consulta ni modifica PostgreSQL y no implementa endpoint ni worker HTTP. Las validaciones semánticas de cada tipo de operación y la escritura deben realizarse dentro de una transacción de servidor con identidad, revisión e idempotencia; no se debe conectar todavía el worker ni confirmar operaciones desde esta capa. El contrato tampoco convierte al gestor singleton en multi-torneo.


## Corrección: canonicalización idéntica en cliente y servidor

La revisión del contrato encontró un caso límite importante: al canonicalizar un objeto JSON con una clave literal `__proto__`, la outbox del navegador construía el objeto normal `{}` y podía invocar el setter heredado en vez de conservar la clave. El validador de servidor ya utilizaba objetos sin prototipo, por lo que ambos lados podían calcular hashes diferentes para el mismo payload.

Se corrige la outbox para construir los objetos canonicalizados con prototipo nulo, preservando literalmente `__proto__` sin modificar prototipos. Se añaden pruebas para claves especiales y una prueba cruzada que exige que cliente y servidor produzcan exactamente el mismo SHA-256.

Esta corrección no amplía el alcance funcional: no hay endpoint ni worker, y el ACK sigue reservado a una confirmación remota real.


### Ajuste de compatibilidad ESM en pruebas

La compilación Preview detectó imports relativos sin extensión en los archivos de test del validador (TypeScript con resolución Node16/NodeNext). Se corrigieron para usar la extensión `.js` que espera el proyecto ESM. La compilación de Vercel llegó a completar el despliegue, pero el log de diagnóstico mostró ese error de TypeScript en los tests; por tanto, el build anterior no se considera validación suficiente de esta corrección. Se espera un nuevo Preview con el ajuste.


## Incremento: política de autorización para operaciones entrantes

Se añade `api/sync-operation-policy.ts` como segunda frontera, separada del validador del sobre de transporte. La política aplica la matriz de autoridad aprobada para operaciones Tabulación → Gestor:

- Requiere que el llamador indique que la sesión privada del gestor ya se ha verificado.
- Compara el UUID de la operación con la identidad canónica cargada por el servidor; nunca confía en el nombre ni en IDs locales.
- Solo admite la vía explícita `publish-round` sobre `round` y `replace-acta` sobre `acta`.
- Rechaza `upsert` genérico: permitirlo podría modificar equipos, jueces, oradores o salas saltándose la autoridad del gestor y sus validaciones específicas.
- Rechaza escrituras `settings` desde Tabulación: las reglas solo se editan en Gestor → Configuración.

La política devuelve códigos diferenciados para sesión ausente, identidad de torneo distinta y operación no permitida. Se añaden pruebas de los límites de autorización. El módulo queda incluido expresamente en `npm run typecheck:api`, además de la suite `npm run test:coverage`.

**Límite deliberado:** esta política todavía no está conectada a un endpoint ni realiza escrituras. El siguiente paso es definir validadores de dominio para publicación de ronda y acta, y después implementar la recepción transaccional con idempotencia, revisión y auditoría. No hay worker HTTP ni ACK remoto. No se han ejecutado migraciones ni escrituras en Neon.


## Incremento: validación de dominio de propuestas de ronda

Se añade `api/tabulation-sync-domain.ts` para validar la propuesta exacta que genera `buildOutbox` antes de cualquier futura escritura remota. La validación de dominio es independiente de la validación del sobre/hash y de la política de autorización.

Comprueba, entre otros puntos:

- Identidad canónica del torneo y coincidencia exacta de revisión/fecha base del gestor.
- Formato y versión de la propuesta, fecha, nombre de ronda y presencia de debates.
- Existencia y estado activo de salas físicas, equipos y jueces.
- Una única asignación por sala y por equipo dentro de la ronda.
- Equipos enfrentados distintos.
- Ausencia de jueces duplicados o asignados simultáneamente en varias salas.
- Incompatibilidades de juez-equipo, juez-juez y conflictos de institución, según la misma matriz que utiliza el gestor.
- Tamaño mínimo del panel y pertenencia de la presidencia al panel asignado.

Se añaden pruebas unitarias de casos válidos, referencias inexistentes, entidades inactivas, duplicados, paneles insuficientes, identidad y revisión obsoletas. El nuevo módulo se incluye en `npm run typecheck:api`.

**Límite deliberado:** el validador no escribe en PostgreSQL, no publica la ronda y no genera ACK. La publicación continúa siendo una acción explícita del gestor; esta validación será una precondición de la futura transacción de publicación. La política también debe seguir aplicándose después de validar el sobre. No se han ejecutado migraciones ni escrituras en Neon.


## 8.1 Validador de dominio de actas — primera capa

Se añade `api/tabulation-acta-domain.ts` como validador puro de la propuesta de acta. El contexto debe proceder del estado canónico cargado por el servidor, nunca del cliente como autoridad.

El payload conserva identidad UUID, revisión y fecha base, ronda, debate y el `TabDebateResult` fuente completo. Se validan referencias de equipos/oradores/jueces, duplicidad de papeletas, contadores de sanciones, modo `judges` frente a `joint`, votos de eliminatorias y decisiones manuales justificadas. Para comprobar que el acta está completa y es válida se reutiliza `computeDebateOutcome`, el mismo motor de Tabulación; no se replica el cálculo de votos, sanciones, rúbricas ni ganador.

El validador no proyecta a `RoundScorecard`, no agrega ni descarta papeletas, no sustituye una scorecard, no hace diff, no incrementa reescrituras y no persiste ni confirma ACK. Esos pasos requerirán una futura transacción con procedencia, historial e idempotencia. Se añaden pruebas unitarias; su ejecución queda pendiente de una ejecución real.
