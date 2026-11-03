# Iteración: shell único de Gestión y Tabulación

## Cambios realizados

- El punto de entrada monta una sola raíz React para la aplicación de Gestión.
- La ruta histórica `/tabulacion` se conserva como redirección compatible a `/#tabulation`; no monta un segundo root ni una página independiente.
- El shell de Gestión expone Resumen, Rondas y salas y Tabulación.
- Tabulación se carga de forma diferida dentro del contenido del shell y mantiene sus secciones internas (Inicio, Reglas, Participantes, Rondas, Actas, Clasificación y Registro).
- Los atajos heredados que apuntaban a Equipos/Jueces/Puntuaciones/Torneo/Configuración se redirigen a Participantes/Actas/Clasificación/Reglas.
- La ruta pública `/acta` permanece separada porque la utilizan jueces externos y no debe exigir sesión del gestor.
- Se conserva la outbox IndexedDB, el dispatcher de comandos tipados y el diario remoto de operaciones. El ACK de una operación remota no debe inferirse del health check.
- Tabulación conserva su store local para disponibilidad offline y ahora sincroniza cambios del dominio participante con el gestor/Neon mediante la revisión remota disponible.

## Retirada de versiones locales antiguas

Esta iteración retira el acceso operativo al frontend independiente de Tabulación y elimina sus enlaces de navegación. No borra todavía los stores, claves, formatos ni componentes legacy: el inventario `LEGACY_HANDOFF_INVENTORY.md` documenta consumidores de handoffs, mappings, ACKs, borradores, logs y backups. Eliminarlos sin migración/exportación verificada podría perder actas o impedir recuperar entregas pendientes.

Los antiguos formularios internos de Gestión permanecen temporalmente en el código, pero ya no aparecen en la navegación principal y los accesos contextuales conocidos se redirigen a las vistas integradas. La eliminación física de esos componentes requiere verificar que no quedan consumidores, pruebas de equivalencia y un plan de rollback.

## Límites de sincronización

La integración visual no equivale a una sincronización total. En esta rama:

- Participantes se proyectan al snapshot remoto del gestor con revisión optimista; los conflictos bloquean la sobrescritura.
- Publicación de rondas y operaciones de actas usan la outbox local y el diario remoto, con ACK e idempotencia.
- Se ha incorporado la recuperación de ACK ambiguos: antes de repetir una escritura de ronda/acta, el dispatcher consulta el resultado idempotente de Neon. El endpoint verifica sesión, torneo, operationId, tipo/ID de entidad y hash contra el diario antes de devolver el resultado previo.
- Los tests del dispatcher cubren la recuperación de un acta ya confirmada sin repetir preview ni escritura.
- El journal solo autoriza actualmente los comandos tipados de publicación de ronda y sustitución de acta. No es una API genérica de mutación.
- Las reglas siguen siendo propiedad del gestor y necesitan persistencia/lectura versionada desde el mismo contexto remoto.
- La reconstrucción multi-dispositivo del agregado completo (rondas, asignaciones, reglas, actas, resultados y proyecciones) todavía no está demostrada de extremo a extremo.
- No se ha validado el ciclo completo de publicación → asignación del cronómetro → control desde otra sesión → acta → clasificación con dos clientes y Neon aislado.

## Validación y despliegue

- Los cambios se han sometido a GitHub Actions mediante PR #88. Los jobs de `verify` y `e2e` continúan en cola; todavía no hay resultado de test que permita declarar CI aprobada.
- Se han consumido 2 de los 3 deployments autorizados. Ambos han terminado en `BUILD_FAILED / Resource provisioning failed`, también con máquina de build turbo. Vercel no ha proporcionado eventos de build; el fallo ocurre antes de que podamos atribuirlo a TypeScript, Vite o al código de la aplicación.
- Se reserva el tercer y último deployment. No se utilizará hasta que CI avance o exista una corrección concreta que merezca validar.
- No se ha realizado ninguna migración ni escritura de prueba en Neon Production.
- Mantener PR #88 en Draft hasta completar CI, Preview, pruebas multi-cliente y comprobación de los cronómetros.

## Criterio de cierre

No marcar la solución como production-ready hasta que todos los flujos de escritura y lectura compartan autoridad remota, las operaciones sobrevivan a recarga y segundo dispositivo, los conflictos sean resolubles sin pérdida, y el recorrido de cronómetros y actas pase las pruebas de integración/E2E.
