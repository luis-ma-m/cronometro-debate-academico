# Decisiones funcionales aprobadas — integración Tabulación ↔ Gestor

> Este documento es un apéndice vinculante de `TABULATION_MANAGER_SYNC.md`. Registra las decisiones confirmadas por producto para que desarrollo no tenga que inferir comportamientos a partir de alternativas o recomendaciones anteriores. En caso de contradicción, prevalece este documento para las decisiones funcionales aquí tratadas; los límites técnicos y de seguridad del contrato principal siguen vigentes.

## 1. Autoridad y sincronización de entidades

1. Se confirma la matriz de autoridad descrita en la especificación principal:
   - Gestor: identidad del torneo y entidades compartidas (equipos, oradores, jueces, instituciones, incompatibilidades, salas físicas, rondas y asignaciones oficiales).
   - Tabulación: cálculo de actas, resultados y clasificación, sujetos al proceso de validación y publicación oficial definido aquí.
   - Reglas: fuente única editable en Gestor → Configuración.
2. Cuando el gestor cambie entidades compartidas mientras Tabulación está abierta, aplicar automáticamente los cambios que no alteren datos históricos. Si el cambio afecta a actas, rondas, resultados u otra información histórica, conservar el estado y solicitar confirmación explícita antes de aplicarlo.
3. Si existen cambios locales pendientes y llega una actualización remota, preservar ambas versiones. No descartar silenciosamente ninguna. Mostrar el conflicto/diff y permitir al gestor resolverlo.
4. La generación de rondas y cruces puede realizarse localmente. El resultado generado es un borrador: el gestor debe poder revisarlo y solo se convierte en asignación oficial cuando pulsa una acción explícita de **Publicar ronda**. No publicar automáticamente por sincronización ni por reconexión.

## 2. Actas: guardado, sustitución y auditoría

### 2.1 Guardado y sustitución

- Al guardar un acta local, intentar sincronizar automáticamente si no existe todavía un acta oficial para esa asignación.
- Si ya existe un acta oficial, no sobrescribirla automáticamente: mostrar una comparación entre la versión oficial y la nueva propuesta y pedir confirmación explícita para sustituirla.
- El flujo debe ser idempotente y revisionado. Un timeout ambiguo no puede generar una segunda sustitución ni incrementar artificialmente el contador de reescrituras.
- Una corrección posterior de un acta sincronizada crea una nueva versión; no edita ni elimina la versión anterior. Tras mostrar el diff, la nueva versión pasa a ser vigente solo con confirmación explícita.
- Registrar actor, fecha, operationId, hash, revisión anterior/nueva, asignación y referencia a la versión sustituida.

### 2.2 Contador de reescrituras por sala

- Cada sala/asignación debe exponer un contador visible de reescrituras de acta.
- La UI de la sala debe mostrar un aviso claro cuando haya habido reescrituras, indicando la cantidad exacta (por ejemplo, «Acta reescrita 2 veces»).
- Definición: una reescritura es cada sustitución confirmada de un acta oficial por una nueva versión. La creación inicial no cuenta como reescritura; cancelar una confirmación, guardar un borrador o reintentar una operación idempotente tampoco cuenta.
- El contador se deriva del historial persistido de versiones/sustituciones en backend, no de un contador local susceptible de perderse o duplicarse.
- El historial debe permitir consultar versiones anteriores y quién/cuándo realizó cada sustitución. La sala muestra el contador aunque el dispositivo actual no haya presenciado las reescrituras.
- La actualización del contador y la creación de la nueva versión deben confirmarse en la misma transacción.

### 2.3 Modo de papeletas por juez

- Conservar todas las papeletas individuales de cada juez en el backend como fuente auditable, incluyendo puntuaciones, votos, notas y metadatos que formen parte del acta.
- Generar además una representación agregada compatible con el modelo actual del gestor cuando sea necesario para clasificación/scorecard. La regla de agregación debe estar definida por el reglamento/configuración del torneo y ser reproducible; no introducir una media o descarte de extremos implícito.
- El resultado agregado debe conservar la procedencia hacia las papeletas fuente. Nunca descartar las papeletas originales después de calcular el agregado.

### 2.4 Acta conjunta

- Conservar íntegramente la información del acta conjunta: ganador declarado, rúbrica/ítems, puntuaciones, sanciones, notas y snapshot de reglas aplicado.
- La scorecard del gestor puede ser una proyección compatible, pero no sustituye ni reduce el acta fuente. Debe ser posible reconstruir y auditar el contenido original.

### 2.5 Eliminatorias

- Para eliminatorias se adopta un resultado explícito de enfrentamiento con, como mínimo, equipo ganador, equipo perdedor y equipo(s) que avanzan/clasifican.
- No forzar una eliminatoria dentro de una scorecard de ronda clasificatoria ni inferir el ganador únicamente a partir de una puntuación agregada si el acta declara otro resultado.
- Validar que ganador/perdedor pertenecen a la asignación, que el resultado no es contradictorio y que la progresión al siguiente cuadro es válida. Conservar acta fuente, evidencia y auditoría.
- El modelo y API del gestor deben soportar este resultado de eliminatoria como entidad de dominio diferenciada de `RoundScorecard`.

## 3. Reglas: editor único y aplicación temporal

- El editor oficial reside exclusivamente en **Gestor → Configuración → Reglas de tabulación**.
- Una vez vinculado el torneo, Tabulación muestra las reglas sincronizadas en modo lectura. No debe ofrecer un segundo editor local.
- Cuando el gestor modifica reglas, puede elegir entre:
  1. **Aplicar desde ahora:** la nueva versión afecta a las rondas/actas futuras; las rondas anteriores conservan el snapshot de reglas con el que fueron evaluadas.
  2. **Aplicar retroactivamente:** recalcular también el histórico afectado con la nueva versión.
- La aplicación retroactiva requiere mostrar previamente el alcance (rondas, actas, clasificaciones y resultados afectados), una comparación/estimación del impacto cuando sea posible y confirmación explícita.
- La operación retroactiva debe ser transaccional o ejecutarse como job durable con estado, progreso, idempotencia y posibilidad de recuperación. No dejar una mezcla silenciosa de rondas recalculadas y no recalculadas.
- Conservar la versión anterior y los resultados previos para auditoría/rollback lógico. Registrar quién inició el recálculo, qué versión de reglas aplicó y cuándo terminó.
- Los snapshots de reglas por ronda/acta son obligatorios para que «Aplicar desde ahora» no reinterprete el histórico.

## 4. Funcionamiento offline como requisito global

- Todas las funcionalidades operativas de Tabulación deben seguir funcionando sin conexión al backend: abrir el torneo y sus datos ya descargados, consultar y editar entidades locales permitidas, crear/revisar rondas, registrar y corregir borradores de actas, calcular clasificación local, consultar histórico descargado, y guardar/exportar/compartir datos locales.
- El backend nunca será requisito para guardar un acta local ni para que los cronómetros y la operación de sala continúen.
- Usar persistencia local duradera y outbox para operaciones remotas. El estado local debe sobrevivir recarga y cierre/reapertura. La pérdida de conectividad no puede borrar ni bloquear datos ya descargados.
- En reconexión, ejecutar sincronización automática mostrando progreso y resultados. Los conflictos no se resuelven sobrescribiendo: se presentan para decisión del gestor.
- Si dos dispositivos han trabajado offline, combinar automáticamente cambios independientes/compatibles. Si ambos modificaron el mismo dato de forma incompatible, conservar ambas propuestas y solicitar resolución; nunca usar «el último que sincroniza gana» para actas, reglas, puntuaciones, rondas o asignaciones.
- Los enlaces cortos persistidos en servidor necesitan backend para resolverse. Por tanto, no pueden prometerse como resolubles durante una caída. Cuando no sea posible crear un enlace corto offline, generar el formato autocontenido A2 localmente como vía de contingencia; no añadir A2 automáticamente al mensaje cuando sí se haya generado un enlace corto, salvo que el usuario elija compartir el fallback. Los A1/A2 históricos siguen siendo válidos.

## 5. Enlaces de WhatsApp: formato, caducidad y revocación

- Cuando el backend esté disponible, el formato preferente para compartir es el enlace corto de ocho caracteres. No incluir automáticamente un segundo enlace A2 en el mismo mensaje.
- Si no puede crearse un short link por falta de conectividad o error del backend, permitir generar y compartir A2 autocontenido desde el cliente para mantener la operativa offline. La UI debe distinguir claramente ambos formatos y sus límites.
- Cada enlace corto tendrá una caducidad configurable. El gestor podrá seleccionar/cambiar la duración al crear el enlace y gestionar la caducidad de enlaces existentes, sin extenderlos accidentalmente.
- Debe existir gestión de revocación:
  - revocar un enlace individual;
  - seleccionar y revocar varios enlaces concretos;
  - revocar todos los enlaces del torneo (acción masiva).
- Las acciones masivas requieren confirmación y resumen del número de enlaces afectados. La revocación es efectiva en backend y la resolución debe rechazar inmediatamente enlaces expirados o revocados.
- Revocar un enlace no elimina el acta fuente ni las respuestas ya recibidas; solo impide nuevas resoluciones del token.
- Mantener el historial de creación, cambio de caducidad y revocación con actor/fecha/motivo cuando exista.
- La reutilización del mismo enlace para una misma convocatoria/contexto debe abrir el mismo snapshot y contexto original; no debe reconstruirse silenciosamente con reglas o participantes actuales. Si se necesita un snapshot nuevo, se crea un nuevo enlace.

### Implementación incorporada en PR79 (HEAD posterior a 5afe192)

- `0020_acta_short_links.sql` crea almacenamiento append-only de snapshots y eventos de gestión.
- Los IDs se generan con 5 bytes criptográficos codificados en Crockford Base32: exactamente 8 caracteres, sin caracteres ambiguos.
- La API crea snapshots inmutables con SHA-256, idempotencia por solicitud, resolución pública limitada por IP y rechazo de tokens inválidos, caducados o revocados.
- La UI de Actas por WhatsApp usa enlaces S8 cuando hay sesión/backend; si falla la creación, genera A2 autocontenido. No concatena ambos formatos.
- La gestión permite configurar 1/7/30/90/365 días al crear, modificar caducidad, revocar individualmente, seleccionar varios o revocar todos los del torneo. Cada acción queda en `acta_short_link_events`.
- La reutilización de una solicitud conserva el mismo snapshot; un nuevo snapshot usa una nueva clave de idempotencia. Tras revocar/caducar, el cliente rota la clave al regenerar.
- A1/A2 y ACTA1/ACTA2 se conservan para compatibilidad histórica.

## 6. Sincronización y conflictos multi-dispositivo

- El comportamiento de reconexión es automático con progreso visible.
- La sincronización automática solo aplica operaciones no conflictivas y respetando dependencias. En conflicto, mantener ambas versiones y abrir flujo de resolución.
- Usar revisión base, IDs estables, operationId y hashes de payload. Un mismo operationId con payload distinto es error.
- No resolver conflictos mediante last-write-wins en datos de torneo con impacto competitivo.
- Las operaciones de publicación de ronda, sustitución de acta, aplicación retroactiva de reglas y revocación masiva requieren confirmación/autorización explícita y auditoría.

## 7. Criterios de aceptación adicionales

### Publicación de rondas
- [ ] La ronda puede generarse offline como borrador.
- [ ] El gestor puede revisar los cruces/asignaciones antes de publicar.
- [ ] Solo la acción explícita «Publicar ronda» crea o actualiza asignaciones oficiales.
- [ ] Una ronda no se publica dos veces por reintento o reconexión.

### Actas y reescrituras
- [ ] El primer guardado de un acta sin versión oficial puede sincronizarse automáticamente.
- [ ] Si ya existe versión oficial, la sustitución requiere diff y confirmación.
- [ ] El contador de reescrituras por sala aumenta exactamente una vez por sustitución confirmada.
- [ ] La sala muestra el número de reescrituras y permite consultar el historial.
- [ ] Papeletas individuales y acta conjunta se conservan íntegramente.
- [ ] La scorecard agregada conserva trazabilidad hacia su fuente.
- [ ] Eliminatorias guardan ganador, perdedor y clasificados en modelo específico.

### Reglas
- [ ] Tabulación vinculada solo permite lectura de reglas.
- [ ] El gestor puede elegir aplicación futura o retroactiva.
- [ ] Aplicar desde ahora conserva snapshots históricos.
- [ ] Aplicar retroactivamente muestra alcance, exige confirmación y deja auditoría/versiones previas.

### Offline y multi-dispositivo
- [ ] Las funciones operativas descritas permanecen disponibles offline.
- [ ] Reconexión muestra progreso y sincroniza automáticamente cambios compatibles.
- [ ] Dos dispositivos offline pueden reconciliar cambios independientes.
- [ ] Conflictos incompatibles conservan ambas propuestas y requieren decisión.
- [ ] No hay pérdida de datos por recarga, cierre, timeout o fallo de backend.

### Short links
- [ ] El mensaje online contiene el enlace corto, sin fallback A2 añadido automáticamente.
- [ ] Si no se puede crear short link offline, se puede compartir A2 generado localmente.
- [ ] La caducidad es configurable y se puede modificar para enlaces existentes.
- [ ] Se pueden revocar enlaces individuales, seleccionados o todos los del torneo.
- [ ] Los enlaces expirados/revocados no resuelven.
- [ ] Reutilizar un enlace conserva el snapshot original.

## 8. Notas técnicas que el desarrollo debe respetar

1. «Todas las funcionalidades offline» no significa que una URL corta almacenada en Neon pueda resolverse sin servidor. La garantía offline se aplica a la creación/uso local de datos y a la generación del formato autocontenido cuando no se pueda crear el short link; la resolución de un short link sigue dependiendo del backend.
2. «Solo enlace corto» es la política normal de WhatsApp cuando se crea correctamente. No prohíbe usar A2 como mecanismo de contingencia cuando el short link no puede crearse; sí prohíbe añadirlo automáticamente como segundo enlace en cada mensaje.
3. El contador de reescrituras debe ser una proyección del historial de versiones confirmado en servidor, no un campo incrementado en cliente.
4. La agregación de papeletas no puede decidirse mediante una media arbitraria: debe respetar la regla de puntuación configurada y conservar todas las fuentes.
5. La aplicación retroactiva de reglas puede cambiar clasificaciones históricas y resultados publicados. Debe ser una operación deliberada, auditable y recuperable, nunca una consecuencia automática de guardar configuración.
