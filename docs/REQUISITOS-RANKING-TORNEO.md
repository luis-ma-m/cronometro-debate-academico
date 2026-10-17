# Exploración y requisitos funcionales — Ranking de clasificatorias

## Objetivo y alcance

Añadir una pestaña **Torneo** al panel privado de LEDU Control para consultar, en una misma vista, (1) la clasificación de equipos en la fase clasificatoria y (2) cinco rankings individuales de oradores: mejor orador global y mejor orador por posición.

Este documento recoge el diseño funcional, las reglas de cálculo, el tratamiento de casos límite y los criterios de aceptación de la funcionalidad de ranking.

## Exploración de la implementación actual

- `src/domain.ts` modela rondas con `scoreType` (`qualifying` o `elimination`), equipos con ID estable y un catálogo de oradores asociados a un equipo.
- `src/scoring.ts` contiene `ScoringConfig`, categorías configurables y actas `RoundScorecard`. Cada acta conserva los dos equipos evaluados, su suma de categorías en `TeamScore.total` y una lista de `SpeakerScore` con `speakerId`, `teamId`, `position` y nota de 0 a 10 en incrementos de 0,5.
- Las posiciones ya normalizadas son `introductor`, `first_rebuttal`, `second_rebuttal` y `concluder`.
- `src/App.tsx` ofrece actualmente Resumen, Rondas y salas, Equipos, Jueces, Puntuaciones y Configuración; no existe una pestaña Torneo.
- Las puntuaciones se persisten con la configuración en Google Sheets y pasan por las funciones de lectura/escritura existentes. El ranking debe ser un cálculo derivado de las actas existentes, sin mantener contadores ni copias del resultado que puedan desincronizarse.
- La clasificación descrita en este requisito aplica a rondas clasificatorias. Las rondas eliminatorias no admiten actas según las reglas actuales.

## 1. Pestaña Torneo y disposición

La navegación privada tendrá una nueva entrada **Torneo**. La vista combinará dos áreas claramente diferenciadas:

1. **Clasificación por equipos**, como tabla principal.
2. **Rankings de oradores**, junto a la clasificación en pantallas anchas y debajo de ella en pantallas estrechas. Debe poder leerse en móvil sin obligar a desplazarse horizontalmente por toda la página; las tablas podrán tener desplazamiento propio si resulta necesario.

Si no hay actas todavía, mostrar una explicación de que la clasificación se irá completando cuando se registren actas de debates clasificatorios finalizados. No mostrar errores ni puntuaciones artificiales.

## 2. Clasificación de equipos

### Métricas por equipo

Por cada equipo se calculará:

- **Victorias**: número de actas clasificatorias en las que el equipo supera al rival en la puntuación total de ítems.
- **Derrotas**: número de actas clasificatorias en las que el rival obtiene una puntuación total superior.
- **Puntuación total de ítems**: suma de los `TeamScore.total` del equipo en todas las actas clasificatorias válidas donde figure.
- **Debates puntuados**: número de actas clasificatorias válidas donde figure el equipo, recomendable para dar contexto a la puntuación acumulada.

Las victorias y derrotas se derivan de la comparación de los totales de ambos equipos dentro de cada acta. Una nota de equipo es la suma de sus categorías, ya calculada y validada por el modelo de puntuación; no se suman las faltas ni se mezclan notas individuales de oradores.

### Orden del ranking

Orden descendente por:
1. Número de victorias.
2. Puntuación total de ítems.

Si ambos criterios coinciden, los equipos comparten la misma posición competitiva. La interfaz puede usar nombre del equipo como orden visual estable dentro del empate, pero no debe presentarlo como un criterio deportivo de desempate.

### Empates y resultados incompletos

- Si los dos equipos de un acta tienen el mismo total, el debate se considera **empate**: no suma ni victoria ni derrota a ninguno. Este requisito no define puntos de clasificación adicionales por empate.
- Solo cuentan actas guardadas de rondas clasificatorias que contengan ambos equipos y sus totales válidos. No contar rondas eliminatorias, salas no finalizadas sin acta, actas pendientes o debates sin puntuación.
- Una acta puede editarse; al recalcular, la clasificación debe reflejar la última versión sin duplicar el resultado.
- Un equipo sin actas aparece con 0 victorias, 0 derrotas y 0 puntos. No excluir equipos activos del ranking por no haber debatido todavía; si el catálogo contiene equipos inactivos, no incluirlos por defecto en la clasificación visible, salvo que el producto decida explícitamente lo contrario.
- Los cambios de nombre no deben romper los vínculos, que se basan en IDs.

### Tablas sugeridas

Columnas principales: **Posición · Equipo · Victorias · Derrotas · Puntuación de ítems · Debates puntuados**. El desempate visual dentro de una misma posición puede resolverse por nombre, alfabéticamente.

## 3. Rankings de oradores

Mostrar cinco rankings independientes:
- **Mejor orador**: sumatorio de todas las puntuaciones individuales recibidas por ese orador en actas clasificatorias válidas, sin filtrar por posición.
- **Mejor introductor**: sumatorio únicamente de puntuaciones en las que `position === "introductor"`.
- **Mejor 1.er refutador**: sumatorio únicamente de puntuaciones en las que `position === "first_rebuttal"`.
- **Mejor 2.º refutador**: sumatorio únicamente de puntuaciones en las que `position === "second_rebuttal"`.
- **Mejor conclusor**: sumatorio únicamente de puntuaciones en las que `position === "concluder"`.

### Reglas de cálculo

- Una puntuación individual se cuenta una única vez, a partir de las entradas `SpeakerScore` guardadas en las actas clasificatorias. La unidad de observación es cada nota de orador en cada acta.
- En los rankings por posición, si una persona ha desempeñado otras posiciones en otras rondas, esas notas no entran en el sumatorio de esa posición. Por ejemplo, para «Mejor introductor» solo cuentan sus apariciones como introductor.
- Si un orador no ha recibido ninguna nota para un ranking, no aparece en ese ranking. No asignar un sumatorio igual a cero ni inferir puntuaciones a partir de su participación en el roster.
- No mezclar nombres para identificar personas: agregar por `speakerId`. Utilizar el nombre histórico guardado en la puntuación si existe, con fallback al catálogo actual.
- Mostrar **sumatorio acumulado**, **número de puntuaciones** y **equipo** junto al nombre.
- Para un empate de sumatorio, asignar la misma posición competitiva. La cantidad de puntuaciones sirve como contexto, pero no debe romper el empate deportivo salvo decisión explícita futura.

### Nota metodológica y comparabilidad

El ranking refleja el sumatorio de ítems, no la media: la puntuación acumulada representa el total de aportaciones en cada posición. Se muestra el número de evaluaciones para aportar contexto.

## 4. Datos, arquitectura y persistencia

- No añadir un modelo persistido específico para rankings ni escribir resultados agregados en Google Sheets: calcularlos a partir de `Tournament.scoring.scorecards` y los equipos/oradores.
- Reutilizar `Round.scoreType`; los valores ausentes continúan interpretándose como `qualifying`, tal como hace el sistema hoy.
- Centralizar la lógica de agregación en funciones puras (idealmente junto al modelo de puntuaciones o en un módulo específico de ranking) para poder probarla sin React ni Google Sheets.
- La vista debe consumir la misma fuente de datos actualizada que el panel; no crear un intervalo de refresco independiente. Respetar `DATA_REFRESH_INTERVAL_MS`.
- Mantener los IDs como claves y proteger las actas históricas de cambios en los nombres.
- No cambiar el esquema de Google Sheets ni activar una migración destructiva.

## 5. Criterios de aceptación

### Ranking de equipos
1. Aparece una entrada de navegación llamada **Torneo**.
2. La tabla incluye los equipos activos, aunque aún no tengan puntuaciones.
3. Los equipos se ordenan primero por victorias y después por suma de ítems.
4. La suma de ítems usa los totales de equipo registrados en las actas; no usa las faltas ni las notas de orador.
5. Las actas de rondas eliminatorias y las asignaciones sin acta no influyen.
6. Los empates de totales de un debate no suman victoria ni derrota; equipos empatados según los criterios del ranking reciben la misma posición.
7. Editar un acta actualiza las métricas sin duplicar el debate y sin necesitar una migración ni una escritura adicional de resultados derivados.

### Rankings de oradores
8. Se muestran cinco categorías con los nombres indicados.
9. El ranking global calcula el sumatorio de todas las notas clasificatorias del orador, independientemente de su posición.
10. Cada ranking posicional filtra exclusivamente por su posición correspondiente; las rondas en las que el orador no tuvo ese papel no afectan a ese sumatorio.
11. Los sumatorios no incluyen actas eliminatorias, puntuaciones ausentes ni oradores sin notas aplicables.
12. Se muestran sumatorio acumulado y número de puntuaciones; las notas repetidas del mismo orador en diferentes actas se cuentan según cada acta válida.
13. Los agregados se identifican mediante IDs estables y soportan renombres de equipos y oradores.

### Calidad y usabilidad
14. La vista tiene estados vacíos claros y es utilizable en escritorio y móvil.
15. Hay tests unitarios para victorias, derrotas, empates, orden del ranking, actas editadas, exclusión de eliminatorias y sumatorios por posición con número de muestras desigual.
16. CI pasa `npm test`, `npm run typecheck:api` y `npm run build`.
17. Se mantiene la cadencia de actualización compartida y no se introducen migraciones destructivas.

## Decisiones y límites explícitos

- El criterio principal es victorias; el segundo, total acumulado de ítems.
- No se propone diferencia de puntos, enfrentamiento directo, desempate por cantidad de debates, puntos por empate ni promedio de puntos por equipo como criterios adicionales de clasificación.
- Las posiciones de oradores se basan en la posición almacenada en el acta, no en inferencias a partir de las fases del formato.
- El ranking solo refleja datos puntuados; no predice resultados de debates sin acta.
