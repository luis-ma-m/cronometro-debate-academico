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
