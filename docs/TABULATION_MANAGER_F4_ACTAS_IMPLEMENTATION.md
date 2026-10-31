# Fase 4 — Actas oficiales: estado de implementación y validación

> Registro actualizado a 2026-10-30/31. Este documento complementa `TABULATION_MANAGER_DECISIONS.md` y `TABULATION_MANAGER_SYNC.md`; no los sustituye. Las decisiones funcionales aprobadas prevalecen sobre cualquier descripción anterior de una propuesta técnica.

## Estado real

F4 dispone ya de una implementación funcional en código para el flujo de preview y persistencia de fuentes de acta. No debe describirse como un mero validador/prototipo, pero tampoco como terminada: la evidencia de Actions no demuestra todavía el comportamiento transaccional contra Neon real ni la integración visual completa de todos los tipos de acta.

### Implementado en el HEAD actual

- Contexto autoritativo cargado desde PostgreSQL por `assignmentId`: identidad canónica del torneo, relación torneo/ronda/debate local, ronda/asignación del Gestor, equipos, panel asignado, presidencia, oradores, configuración y metadatos de ronda.
- Canonicalización de las referencias locales a IDs canónicos del Gestor a través del mapa revisado persistido. El servidor valida la pertenencia al debate; el cliente no establece la verdad de los metadatos que afectan al resultado.
- Preview no mutante: valida y prepara propuesta, devuelve versión oficial actual, diff, hash, revisión del Gestor y revisión de reglas.
- Guardado inicial y sustitución transaccionales con bloqueo de asignación, compare-and-swap sobre versión actual y revisión de reglas, fuente inmutable, head actualizado mediante trigger, evento de auditoría y respuesta idempotente por `operationId`.
- Persistencia de resultado de eliminatoria separada de la scorecard clasificatoria. `sourceMode: elimination` representa el tipo de resultado/progresión; la estructura de papeletas sigue respetando `settings.ballotMode` (incluido el modo conjunto ADUMA).
- Historial y detalle de versiones; el contador de reescrituras se calcula en servidor a partir de versiones que sustituyen una fuente anterior.
- UI `OfficialActaPublisher` de comparación, primer guardado/sustitución explícitos y reintento del mismo `operationId` después de error ambiguo.
- En el Gestor, el historial de cada sala permite consultar las versiones oficiales y el contador de reescrituras. Se añade inspección bajo demanda y de solo lectura del payload fuente íntegro y del snapshot de reglas de cada versión; no se reconstruye ni se sobrescribe el acta vigente al consultar.
- Migraciones append-only 0010–0019 definidas en el repositorio. No se han aplicado a Neon Production.

### Validación completada

- GitHub Actions run #1464, HEAD de PR `2c5bb8ae5bcc690531d867b2d15794423371dbfd`: jobs `verify` y `e2e` completados con `success`. `verify` ejecutó `test:coverage`, `typecheck:api` y `build`; E2E ejecutó Playwright.
- Las pruebas son automatizadas en CI y no equivalen a prueba de integración contra una instancia Neon persistente ni a prueba manual multi-dispositivo.

### Pendiente de validación / implementación adicional

- Aplicar las migraciones necesarias únicamente en Neon Preview y validar aplicación secuencial desde los estados de esquema soportados.
- Ejecutar en PostgreSQL real creación inicial, reemplazo, cancelación (sin llamada de escritura), operación idempotente repetida, colisión de `operationId`, dos reemplazos concurrentes, conflicto de revisión, timeout posterior al commit y rollback provocado.
- Verificar que el contexto autoritativo y el mapping de debate/torneo quedan íntegros con datos reales; probar especialmente dos torneos locales que reutilicen IDs locales de ronda/debate.
- E2E real en navegador y dos dispositivos: publicación de ronda, ACK, primera acta, sustitución, historial tras recarga, contador consistente y recuperación del mismo `operationId`.
- Completar y validar los recorridos visuales restantes del historial y definir, si procede, un flujo seguro de restauración como nueva propuesta (nunca reescritura destructiva). La consulta de metadatos, contador y detalle íntegro de versiones ya está implementada en el Gestor; falta validarla con datos reales y tras recarga.
- Asegurar que el estado de reescrituras se muestra en la tarjeta/resumen de la sala del Gestor con el número exacto, no solo en la notificación de Tabulación.
- Verificar la semántica de todos los campos y datos conjuntos/eliminatoria en la UI, no únicamente su persistencia JSONB.
- No marcar F4 cerrada hasta que estas pruebas sean satisfactorias.

## Continuación de implementación — UI de sala y rollback (2026-10-30)

- Al expandir una sala del Gestor, se consulta automáticamente su historial oficial si todavía no está cargado. El contador de reescrituras queda visible también en la cabecera de la tarjeta de sala una vez recuperado el historial; la consulta sigue siendo de solo lectura y no se ejecuta mientras existan cambios locales sin guardar.
- Se añade una prueba de regresión de F4 que fuerza un fallo al insertar el evento de auditoría después de insertar la fuente inmutable. La prueba exige `ROLLBACK`, prohíbe `COMMIT` y comprueba que no se registra la clave de idempotencia incompleta. Es una prueba de contrato con cliente PostgreSQL simulado; no sustituye la prueba de rollback en Neon Preview.

F3: la implementación de pull/reconciliación, snapshot base, conflictos persistentes y cola de publicación de rondas ya está incorporada en este HEAD. No se identifica un bloque adicional de código F3 que pueda cerrarse responsablemente sin la prueba de navegador multi-dispositivo y la validación de IndexedDB en un navegador real. Esas pruebas permanecen como criterios de salida, no se etiquetan como implementadas.

## Nota de Vercel (no bloqueante para la implementación)

El deployment de Preview puede quedar pendiente por la cuota/disponibilidad del plan de Vercel. Esto es una limitación operativa de la cuenta, no un defecto que deba corregirse modificando la arquitectura o el código de la PR. No se condiciona el avance de implementación a resolverla ni se deben hacer cambios estructurales en `api/` por este motivo. Las validaciones de código se siguen realizando mediante GitHub Actions; la validación de Preview quedará pendiente hasta que haya cuota disponible.

## Regla de seguridad operativa

No ejecutar migraciones, mutaciones ni pruebas de escritura en Neon Production. La validación pendiente debe usar una rama/base Preview aislada y datos de prueba. Mantener PR #79 en Draft.


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


La migración 0017 añade una FK para garantizar que la presidencia persistida del debate siga apuntando a un juez existente del Gestor. Migraciones acumuladas de esta ampliación: 0014–0017 (además de 0010–0013 para settings e historial).


La migración 0018 añade `tab_tournament_id` al puente de asignaciones. Preview y guardado verifican que el torneo, la ronda y el debate locales coincidan exactamente con la identidad persistida antes de canonicalizar; ya no basta con que el assignmentId sea válido.

La migración 0019 amplía la clave natural del mapping para incluir el torneo local de Tabulación; así se evita que dos torneos locales distintos colisionen al reutilizar IDs de ronda/debate.
