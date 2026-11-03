# Iteración: shell único y sincronización bidireccional de Tabulación

## Aplicación y navegación
- Gestión y Tabulación se montan dentro de una sola raíz React y un único shell visible.
- `/tabulacion` se conserva como redirección compatible; `/acta` permanece como ruta pública independiente para jueces.
- Los atajos heredados de equipos, jueces, puntuaciones, torneo y configuración conducen a las secciones integradas.
- No se han borrado físicamente todos los componentes legacy ni los stores locales. Se conserva el almacenamiento offline y los datos de recuperación hasta completar una migración/exportación verificada.

## Autoridad remota y sincronización
- El agregado del Gestor se lee y escribe desde PostgreSQL normalizado (Neon) con control optimista de revisión.
- Participantes, oradores, jueces, salas físicas e incompatibilidades se proyectan entre Tabulación y el agregado canónico del Gestor mediante el mapa de identidades y revisión optimista.
- Las reglas de Tabulación se hidratan desde `tabulation_settings` y los cambios locales se guardan en Neon con revisión e idempotencia. Un conflicto no sobrescribe la versión remota; se conserva copia local.
- La publicación de rondas crea en una transacción la ronda, asignaciones, fases del cronómetro, jueces, metadata y mappings de identidad.
- El ACK de publicación actualiza en Tabulación el ID de ronda del Gestor y el mapping de cada debate a su asignación.
- El endpoint `getTabulationPublishedRounds` reconstruye en clientes posteriores las rondas y asignaciones desde Neon, incluyendo los mappings de identidad y las cabezas oficiales de acta. Así el segundo dispositivo no depende de que exista el IndexedDB del dispositivo que publicó la ronda.
- Las actas oficiales se leen desde la versión vigente de `tabulation_acta_heads`/`tabulation_acta_sources` y se vuelven a proyectar a IDs locales antes de calcular resultados y clasificación.
- Las actas se publican mediante outbox IndexedDB, diario remoto, idempotencia y recuperación de ACK ambiguos. La primera escritura no sustituye una versión oficial diferente sin confirmación expresa.
- El worker conserva la cola en desconexiones y solo elimina operaciones con confirmación remota.

## Límites y precauciones
- La sincronización local de Tabulación continúa disponible offline; una edición offline no se convierte en oficial hasta recibir ACK de Neon.
- Los metadatos locales no almacenados por el Gestor (por ejemplo, algunos datos de organización/siembra) siguen preservándose en el navegador que los creó. La reconstrucción remota se centra en participantes, reglas, rondas, asignaciones y actas oficiales.
- El inventario `LEGACY_HANDOFF_INVENTORY.md` sigue siendo la guía para retirar stores, claves, handoffs y componentes antiguos. No eliminarlos hasta verificar todos los consumidores y disponer de rollback.
- No se han ejecutado migraciones ni escrituras de prueba contra Neon Production en esta iteración.
- La reconstrucción multi-dispositivo debe probarse con dos sesiones reales y una base Neon de Preview/aislada; el build por sí solo no demuestra coherencia funcional.
- Dos correcciones posteriores al deployment READY hacen que la reconstrucción use el mapa de identidades del navegador receptor (los IDs locales del navegador emisor nunca se reutilizan) y que el refresco remoto conserve rondas/drafts aún no publicados. Estas correcciones están en el HEAD actual, pero no se han incluido en un deployment porque se agotó el presupuesto de tres.

## Validación y despliegue
- GitHub Actions sigue con jobs `verify` y `e2e` en cola, sin pasos iniciados; el bloqueo está en la ejecución de Actions y no hay resultados que podamos declarar aprobados.
- Los primeros deployments de esta iteración permitieron recuperar los errores de TypeScript ocultos por el fallo de infraestructura. Los errores identificados se han corregido en commits posteriores.
- Presupuesto nuevo autorizado: 3 deployments. El primer deployment de este nuevo presupuesto detectó fallbacks JSON y un cast de acta conjunta que se corrigieron; el segundo confirmó que quedaba el cast sin corregir en el commit desplegado. El tercero queda reservado para validar el commit corregido.
- Mantener PR #88 en Draft hasta que el build pase, la Preview responda, se verifique el endpoint con Neon aislado y se complete el recorrido con dos clientes.

## Criterio de cierre
No declarar production-ready ni fusionar hasta validar en dos dispositivos: edición de participantes/reglas, publicación de ronda, aparición de asignaciones en Gestión y cronómetros, envío/lectura de actas oficiales, clasificación equivalente, desconexión/reconexión, conflictos y recuperación tras perder un ACK.

## Confirmación directa de rondas y estabilidad de enlaces
- «Confirmar ronda» ya no envía la ronda a la bandeja intermedia de propuestas de Gestión. Genera el payload desde el borrador confirmado y lo incorpora a la outbox durable IndexedDB que despacha la publicación autenticada a Neon.
- La confirmación requiere torneo vinculado, sesión válida y revisión remota conocida. Si falta alguno de estos requisitos, el borrador permanece intacto y no se modifica «Rondas y salas».
- El servidor busca la ronda planificada por número. Si existe y no está activa ni contiene actas oficiales, sustituye sus metadatos y asignaciones dentro de una única transacción; si no existe, crea una nueva únicamente cuando sea el siguiente número disponible.
- Las asignaciones existentes se emparejan por identidad canónica de sala física y conservan su ID de room_assignments. Ese ID es el identificador que alimenta las URLs públicas/control de sala; por tanto, las URLs existentes no rotan al sustituir equipos y jueces.
- Las fases y paneles de jueces de cada asignación reutilizada se reemplazan con el contenido confirmado. Las salas físicas que ya no se usan quedan desasignadas, pero conservan su ID y URL; las salas físicas nuevas reciben una asignación nueva. La operación se rechaza si la ronda está activa, tiene actas oficiales o algún cronómetro ya se ha utilizado.
- La publicación sigue usando operationId, hash de payload, revisión optimista, diario remoto y recuperación de ACK ambiguos. Un error de red deja la operación pendiente para reintento, no crea una segunda ronda.
- No se ha desplegado ni se han hecho escrituras de prueba en Neon Production en esta iteración. La validación de build, CI y el flujo con dos sesiones sigue pendiente.
