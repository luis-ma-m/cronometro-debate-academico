# Requisitos funcionales — registro de puntuaciones por ronda

## Objetivo
Registrar, editar y consultar las puntuaciones de las rondas clasificatorias, preservando un historial auditable ligado a las asignaciones, equipos, jueces y oradores concretos. Las rondas eliminatorias no permiten actas de puntuación.

## Modelo
- Cada ronda tendrá un tipo: `qualifying` (clasificatoria, valor por defecto para rondas existentes y nuevas) o `elimination` (eliminatoria).
- La configuración del torneo dispondrá de categorías de puntuación de equipo editables, cada una con ID estable, nombre y orden. Debe existir al menos una categoría, nombres no vacíos y no duplicados.
- Cada acta de puntuación se vincula por IDs a ronda y asignación/sala, ambos equipos y los jueces que participaron. El conjunto de jueces evaluadores debe coincidir con los jueces asignados a esa sala al registrar el acta.
- Cada equipo recibe una puntuación por categoría, suma total calculada por el sistema, número de faltas leves y graves (enteros no negativos).
- Cada acta podrá incluir hasta ocho puntuaciones de orador, cada una vinculada a un ID de orador registrado del equipo enfrentado, con posición entre introductor, primer refutador, segundo refutador o conclusor y puntuación de 0 a 10, admitiendo medios puntos. Los jueces no puntúan oradores.
- El registro conserva snapshots de nombres/etiquetas además de IDs para mantener legible el historial si posteriormente se renombran equipos, jueces, oradores o categorías.

## Flujo
- Se puede registrar o editar la puntuación en cualquier momento después de que la asignación haya terminado (estado del cronómetro `finished`).
- No se muestra opción de puntuar ni se acepta la operación en backend para rondas eliminatorias, asignaciones sin dos equipos o debates que no hayan finalizado.
- La puntuación debe incluir ambos equipos. Un acta es una unidad atómica: no puede persistirse la puntuación de un equipo dejando el otro sin acta.
- Las puntuaciones e IDs se validan en servidor y se guardan con bloqueo distribuido y revisión optimista; duplicar un acta para la misma asignación no debe crear un segundo registro.
- Se permite editar un acta existente por su asignación, manteniendo la misma identidad y actualizando su marca temporal.
- El resumen principal muestra el número de asignaciones de la ronda seleccionada que finalizaron y aún no tienen acta. Una asignación en curso, pausada, preparada o sin asignar nunca cuenta como pendiente de puntuación.
- La ficha histórica de cada equipo muestra ronda, rival, sala, total, faltas y fecha; las puntuaciones de orador se consultan por historial individual a través de las referencias al orador y su equipo.

## Persistencia y compatibilidad
Para evitar migraciones destructivas o nuevas pestañas de Sheets, las categorías y actas se serializan como JSON en claves independientes de la pestaña `Config`. El guardado de torneo debe preservar esas claves, incluso cuando se modifica cualquier otro catálogo. Los datos ausentes se leen como arrays vacíos y se normalizan sin borrar información desconocida.

## Criterios de aceptación
- Se pueden configurar, ordenar, renombrar y quitar categorías (la validación del backend nunca acepta un acta con una categoría desconocida).
- El formulario ofrece entradas separadas por equipo, sumatorio automático, faltas leves/graves y hasta ocho oradores del roster correcto.
- Un orador no se puede puntuar representando al equipo rival y un mismo orador no puede añadirse dos veces a la misma acta.
- El backend impide puntuaciones para rondas eliminatorias, salas no finalizadas, jueces no asignados o entidades inexistentes.
- Una ronda completada con un acta por sala no deja pendientes; las rondas en curso no anuncian pendientes de puntuación.
- El historial no se pierde si se modifica el nombre actual de una entidad.
- Las pruebas de unidad cubren reglas del modelo y CI ejecuta tests, typecheck de API y build.
