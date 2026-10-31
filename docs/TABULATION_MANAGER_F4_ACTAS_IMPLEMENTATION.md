# Fase 4 — Actas oficiales: diseño de implementación

> Documento de ejecución para F4 de la PR #79. Complementa y no sustituye `TABULATION_MANAGER_DECISIONS.md` ni `TABULATION_MANAGER_SYNC.md`. F4 depende de que F3 proporcione identidad remota, revisión confirmada, outbox durable y resolución de conflictos. No habilitar la escritura de actas oficiales mientras esa base no esté validada.

## Estado de ejecución — inicio de F4

La rama ya contenía una primera base de F4: validación pura del resultado de Tabulación, migración 0012 para historial fuente inmutable y endpoints de lectura de historial/detalle. Eso no equivalía a tener guardado oficial implementado: en el dispatcher todavía no existe una acción de escritura de acta y el historial solo reconocía judges/joint.

**Añadido en este avance:**
- Migración nueva 0013 que amplía el tipo de fuente para admitir elimination y persiste un resultado explícito separado (ganador, perdedor y equipos que avanzan), sin convertirlo en RoundScorecard.
- Validador puro de resultado de eliminatoria con comprobación de que ganador/perdedor pertenecen a la asignación, son distintos, y los equipos que avanzan son únicos e incluyen al ganador.
- Historial y tipos de API preparados para exponer sourceMode elimination y su resultado explícito.
- Canonicalizador puro `api/tabulation-acta-identity.ts`: traduce equipos, jueces y oradores de la fuente local a IDs del Gestor usando exclusivamente el `idMap` revisado; reescribe también las claves de puntuaciones/sanciones/alineaciones, las papeletas, el acta conjunta y el resultado de eliminatoria. El ámbito torneo/ronda/asignación se toma de los objetivos resueltos por el Gestor, no de los IDs enviados por el cliente.
- Tests de identidad: mapeo completo, IDs ausentes, destino fuera de la asignación, colisiones de mapeo, acta conjunta y progresión eliminatoria.
- Se mantiene separada la modalidad de origen persistido (`elimination`) del modo de acta configurado (`judges` o `joint`): la primera identifica la progresión de cuadro; el segundo determina la estructura del resultado. No se fuerza a ADUMA a usar papeletas individuales en eliminatorias.

**Todavía no implementado ni habilitado:**
- Endpoint transaccional de guardado inicial/sustitución y recuperación idempotente.
- Construcción de contexto remoto completo y validación server-side conectada al guardado (el canonicalizador puro existe, pero todavía no está conectado a una consulta/operación autorizada del Gestor).
- Resolver de forma autoritativa los metadatos propios de Tabulación que no existen en el esquema actual del Gestor (por ejemplo, equipos swing/caídos y otros atributos que pueden alterar el ganador calculado). No aceptar estos flags desde el cliente como verdad: deben quedar persistidos/versionados o verificarse contra un snapshot remoto confiable antes de validar el acta.
- Proyección compatible a scorecard cuando corresponda.
- UI de primer guardado, diff, confirmación, historial y contador conectados al endpoint.
- E2E y pruebas reales contra Neon Preview.

F3 sigue siendo una dependencia: este avance añade contrato, esquema y validación de dominio, pero no activa escrituras oficiales. No aplicar la migración 0013 a Neon hasta tener autorización para hacerlo en el entorno Preview de pruebas.

## 1. Objetivo y límites

F4 permite que un acta guardada en Tabulación se convierta en una versión oficial del debate en el Gestor. La fuente completa de Tabulación se conserva siempre; la `RoundScorecard` del gestor es únicamente una proyección compatible para las pantallas y cálculos que todavía la necesiten.

Se implementarán tres contratos de origen distintos:

- `judges`: una papeleta por cada juez, con puntuaciones, votos, notas, oradores y metadatos originales.
- `joint`: acta conjunta íntegra, con ganador declarado, rúbrica por ítem, puntuaciones, sanciones, notas y snapshot de reglas.
- `elimination`: resultado explícito del enfrentamiento con ganador, perdedor y equipos que avanzan. No se convertirá en una scorecard clasificatoria ficticia.

No se permite convertir el origen a una estructura agregada y descartar después los datos que no quepan en ella.

## 2. Modelo persistente propuesto

Añadir migraciones nuevas e inmutables; nunca editar 0010–0012 una vez aplicadas.

### `tabulation_acta_sources`

Una fila por versión confirmada de acta:

- `id` UUID PK.
- `tournament_id` UUID/identidad canónica del torneo.
- `assignment_id` FK a la asignación oficial.
- `source_mode` enum `judges | joint | elimination`.
- `round_kind` enum `qualifying | elimination`.
- `schema_version` entero.
- `source_payload` JSONB completo, validado y versionado.
- `source_hash` SHA-256 calculado en servidor sobre representación canónica.
- `operation_id` único.
- `base_revision` y `committed_revision`.
- `supersedes_source_id` nullable.
- `created_by`, `created_at`.
- `is_current` o referencia vigente mantenida mediante constraint/actualización transaccional.

El payload conserva el contrato original, no solo la proyección. No guardar secretos, tokens ni datos ajenos al debate.

### `tabulation_acta_ballots` (índice consultable opcional)

Si las consultas de auditoría necesitan acceder a papeletas individualmente, normalizar cada papeleta en filas relacionadas con `source_id`, `judge_id`, payload de papeleta y orden. La copia JSONB completa sigue siendo la fuente íntegra e inmutable. Esta tabla no puede introducir una segunda semántica ni alterar el payload.

### Relación con scorecards

La scorecard compatible se guarda/actualiza en la misma transacción que el source, solo cuando el modo y el reglamento permiten una proyección sin pérdida semántica. La relación debe guardar `source_id`, hash y versión de reglas. Una proyección no reemplaza el acta fuente.

Para `joint` y `elimination`, no inventar campos ni aproximaciones en `RoundScorecard`. El modelo del gestor deberá exponer una lectura de dominio específica, aunque las vistas existentes puedan mostrar una proyección limitada.

## 3. DTO de escritura

Contrato versionado sugerido:

```ts
type ActaSourceMode = 'judges' | 'joint' | 'elimination';

type SaveOfficialActaOperation = {
  protocolVersion: 1;
  operationId: string;
  tournamentId: string;
  assignmentId: string;
  sourceMode: ActaSourceMode;
  roundKind: 'qualifying' | 'elimination';
  baseRevision: number;
  baseSourceId: string | null;
  payloadHash: string;
  payload: unknown;
  intent: 'initial-save' | 'replace';
};
```

El servidor valida el payload según `sourceMode`; nunca confía en el hash calculado por el navegador. La validación comprueba:

- identidad canónica del torneo y pertenencia de la asignación;
- ronda, sala, equipos, oradores y jueces pertenecientes al debate;
- ausencia de IDs duplicados y relaciones huérfanas;
- rangos, categorías, rúbrica, sanciones y reglas;
- papeletas exigidas por la configuración y el panel oficial;
- ganador/perdedor/clasificados válidos en eliminatorias;
- límites de tamaño, versión de esquema y hash;
- que el origen y tipo de ronda son compatibles.

## 4. Flujo de guardado y sustitución

### Primer acta oficial

1. Tabulación guarda el acta local en su store antes de cualquier petición remota.
2. Si la asignación no tiene versión oficial, encola `initial-save` automáticamente.
3. El worker transmite la operación con `operationId`, hash y `baseRevision`.
4. El servidor bloquea la asignación/versión vigente, valida y crea la versión inicial en una transacción.
5. El ACK contiene `sourceId`, hash, revisión confirmada y referencia de la scorecard proyectada cuando proceda.
6. El cliente marca la operación como confirmada solo tras ACK verificable o recuperación idempotente por `operationId`.

### Sustitución de acta oficial

1. Detectar que existe `currentSourceId`.
2. Mantener el acta editada como propuesta local; no cambiar la versión oficial.
3. Obtener versión oficial y mostrar diff campo a campo: papeletas, votos, ítems, ganador, sanciones, notas y oradores.
4. El operador confirma expresamente «Sustituir acta oficial».
5. La outbox registra la intención confirmada, `baseSourceId`, `baseRevision`, hash y `operationId`.
6. Servidor verifica que la versión vigente sigue siendo `baseSourceId`. Si cambió, responde 409 y exige descargar y comparar de nuevo.
7. La transacción inserta una versión inmutable, marca la anterior como sustituida, actualiza la referencia vigente, escribe auditoría y recalcula el contador de reescrituras.
8. Solo después del commit se devuelve ACK.

Cancelar el diff no crea una operación remota y no cambia la versión oficial. Un timeout ambiguo se recupera consultando el mismo `operationId`; jamás se genera otra sustitución automática.

## 5. Idempotencia, concurrencia y auditoría

- Índice UNIQUE por `operation_id`.
- Mismo operationId + mismo hash + mismo scope: devolver el resultado original.
- Mismo operationId con hash/scope diferente: `IDEMPOTENCY_MISMATCH` (409).
- Dos sustituciones concurrentes sobre el mismo `baseSourceId`: solo una puede confirmar; la otra recibe 409.
- Insertar source, actualizar scorecard/proyección permitida, cambiar versión vigente, auditoría y contador en una única transacción.
- La auditoría incluye actor, fecha, operationId, asignación, source anterior/nuevo, hash, revisión anterior/nueva y modo de origen.
- No registrar el payload completo, notas privadas ni teléfonos en logs de runtime.

El contador visible de la sala se calcula desde el historial confirmado: `max(0, totalVersions - 1)` solo si todas las versiones posteriores a la inicial representan sustituciones confirmadas. Si existen versiones no vigentes o borradores persistidos, utilizar un contador explícito derivado de eventos `acta_replaced`. Nunca incrementarlo desde el cliente.

## 6. UI requerida

En Tabulación:

- estado local, pendiente de sincronizar, oficial, conflicto y error;
- indicador de revisión oficial y fecha;
- historial de versiones descargadas;
- comparación antes de sustituir;
- confirmación inequívoca con sala, ronda y número de versión;
- cancelación sin efectos remotos;
- reintento que reutiliza la misma operación cuando el resultado es ambiguo.

En el Gestor:

- mostrar estado del acta oficial y versión vigente;
- mostrar aviso «Acta reescrita N veces» cuando N > 0;
- consultar versiones anteriores, actor y fecha;
- mantener la scorecard como proyección, con enlace a su fuente;
- representar acta conjunta y resultado de eliminatoria sin reducirlos a una scorecard.

## 7. Pruebas obligatorias

### Dominio
- payload válido e inválido por cada modo;
- referencias cruzadas incorrectas;
- payload demasiado grande, schemaVersion desconocida y hash incorrecto;
- conservación exacta de papeletas, rúbrica, notas, sanciones y datos de eliminatoria;
- proyección determinista y trazable cuando sea compatible.

### Persistencia / integración Neon
- creación inicial;
- sustitución con diff aprobado;
- cancelación sin escritura;
- rollback si falla auditoría, proyección o actualización de contador;
- misma operación repetida;
- operationId reutilizado con hash diferente;
- dos sustituciones concurrentes;
- revisión o source base obsoleto;
- recuperación tras timeout posterior al commit.

### E2E
- primer guardado offline y sincronización al reconectar;
- sustitución propuesta y cancelada;
- sustitución confirmada;
- dos dispositivos editan el mismo acta: preservar ambas propuestas y resolver por diff;
- contador exacto en ambos dispositivos;
- el historial sigue disponible después de recargar.

## 8. Orden de ejecución

1. Cerrar F3: pull autenticado, base snapshot durable, diff de tres vías, resolución interactiva y pruebas multi-dispositivo.
2. Añadir migración de sources y constraints de idempotencia.
3. Implementar validadores puros por modo.
4. Implementar endpoint transaccional de primer guardado.
5. Implementar lectura de versión vigente e historial.
6. Implementar diff y confirmación de sustitución.
7. Implementar transacción de sustitución y contador.
8. Añadir UI e2e.
9. Probar contra Neon Preview aislado; no tocar Production.

## 9. Criterio de salida F4

F4 no se considera terminada hasta que los tres modos se conservan sin pérdida, el primer guardado y las sustituciones cumplen el flujo aprobado, el historial y contador son consistentes, la concurrencia/idempotencia están probadas en PostgreSQL real y las pantallas del Gestor/Tabulación muestran el estado oficial sin confundirlo con un borrador local.


## Ampliación F3/F4: identidad de debates y contexto autoritativo (2026-10-31)

Se ha añadido una primera capa persistente para eliminar la ambigüedad entre el debate local de Tabulación y la asignación del Gestor:

- Cada debate incluido en una propuesta lleva tabulationDebateId, su identidad local estable. El validador exige un identificador válido y único dentro de la ronda.
- La publicación transaccional escribe tabulation_debate_assignments junto con la asignación. La relación incluye torneo canónico, ronda, debate local, asignación remota, presidencia y si las posturas eran provisionales.
- La respuesta de publicación devuelve debateAssignments (debate local → assignmentId) para que el cliente pueda persistir el vínculo sin inferirlo por orden o nombres.
- La migración 0014_tabulation_debate_assignments.sql crea el puente de identidad.

También se incorpora una instantánea de metadatos propios de Tabulación en la publicación autenticada:

- sideMode de la ronda.
- Por cada equipo activo del Gestor: swing, breakEligible y fallenFromRound opcional.
- El servidor valida tipos, referencias, duplicados y cobertura exacta de equipos activos; no acepta metadatos parciales.
- tabulation_round_metadata conserva la instantánea por ronda. La asignación conserva chair y estado provisional.
- La migración 0015_tabulation_round_metadata.sql añade esta persistencia.

**Conexión cliente ya implementada:** el payload de publicación incluye la identidad local del torneo y de la ronda; el Gestor conserva la respuesta transaccional en una cola de ACK compartida entre pestañas. Tabulación valida el ACK, guarda managerRoundId en la ronda y managerAssignmentId en cada debate correspondiente, actualiza su cursor remoto y solo consume el ACK después de confirmar el guardado local. La escritura es idempotente por operationId; si no se puede guardar localmente, el ACK permanece para reintentar.

**Guardado oficial F4 ya conectado (2026-10-31):**

- `api/tabulation-acta-write.ts` resuelve la asignación por `assignmentId` mediante `tabulation_debate_assignments`; recupera equipos, jueces asignados, oradores, presidencia, postura, metadatos de swing/caído, reglas y revisiones desde PostgreSQL.
- El mapa de entidades local→Gestor queda persistido en `tabulation_round_metadata.entity_id_map` (migración 0016). Cada referencia utilizada por el acta se canonicaliza y se comprueba contra la pertenencia real a esa asignación; no se aceptan IDs de equipos/jueces/oradores ajenos.
- `previewTabulationActa` valida una propuesta contra el contexto actual sin escribir nada y devuelve la versión oficial vigente, hash, modalidad, ganador propuesto y revisiones del Gestor y de reglas.
- `saveTabulationActa` guarda primera versión o sustitución en una única transacción: valida compare-and-swap de la versión vigente y de la revisión de reglas, calcula de nuevo el ganador, inserta fuente inmutable, avanza el head mediante trigger, registra auditoría y almacena ACK idempotente.
- El navegador de Tabulación muestra comparación y botones explícitos de primera publicación/sustitución tanto para papeletas individuales como para actas conjuntas. La copia local sigue siendo el borrador operativo y no se publica automáticamente.
- Si se pierde la respuesta de guardado, el componente conserva el mismo `operationId` y cuerpo para reintentar sin crear una segunda versión.
- Se añade una barrera de revisión separada para `tabulation_settings.revision`; un cambio de reglas entre comparación y confirmación obliga a volver a comparar.

**Pendiente de validación externa:** aplicar 0014–0016 únicamente en Neon Preview, verificar transacciones/rollback y concurrencia real en PostgreSQL, ejecutar E2E de publicación y sustitución en navegador, probar la pérdida real de respuesta y confirmar que el historial refleja el contador exacto. Las migraciones no se han aplicado a Neon Production.
