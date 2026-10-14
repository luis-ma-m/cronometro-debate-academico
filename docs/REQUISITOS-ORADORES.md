# Requisitos funcionales — Gestión de oradores

## Objetivo

Permitir que la organización registre personas concretas que forman parte de cada equipo de debate. Cada orador debe ser una entidad propia, asociada a un único equipo y persistente hasta que se elimine explícitamente desde la pestaña **Equipos**.

Este documento define el alcance funcional y los criterios de aceptación de la implementación.

## Requisitos funcionales

### 1. Acceso y navegación
- La gestión de oradores estará integrada en la pestaña **Equipos**, no en una sección independiente.
- Al seleccionar o desplegar un equipo, la interfaz mostrará un apartado desplegable de **Oradores** vinculado exclusivamente a ese equipo.
- El área permitirá consultar los oradores ya registrados, crear nuevos y eliminar los existentes.
- El selector/apartado debe indicar claramente a qué equipo corresponden las operaciones para evitar cambios sobre otro equipo por error.

### 2. Crear y mantener oradores
- Cada orador tendrá, como mínimo, un identificador estable y único (`id`), un nombre y el identificador del equipo al que pertenece (`teamId`).
- El nombre se introducirá desde la gestión del equipo y será obligatorio tras aplicar `trim`; se rechazará un nombre vacío. Se recomienda establecer un límite de 200 caracteres para alinearlo con las validaciones de entidades existentes.
- El sistema generará el identificador. No se debe utilizar el nombre como clave: puede haber homónimos y el nombre podría cambiar en una futura funcionalidad.
- Una vez creado, el orador permanecerá registrado y seguirá apareciendo al volver a abrir o recargar la aplicación, así como tras guardar otros cambios del torneo.
- El orador no debe desaparecer por cerrar el desplegable, cambiar de pestaña, refrescar la aplicación o editar datos del equipo.
- En esta fase, la pertenencia se gestiona desde el equipo. No se requiere reutilizar una misma entidad de orador en varios equipos ni asignarla a otro equipo mediante arrastrar/soltar.

### 3. Eliminar oradores
- Cada orador tendrá una acción explícita de eliminación accesible desde el apartado de oradores del equipo.
- El borrado debe persistirse en el almacenamiento compartido y la interfaz solo debe confirmar éxito una vez que el backend haya aceptado la operación.
- Si el guardado falla, se mostrará un error y la aplicación no debe presentar el registro como eliminado de forma persistente.
- La acción de eliminación debe afectar únicamente al orador seleccionado.
- Eliminar un orador no debe eliminar al equipo ni modificar otros oradores de ese equipo.

### 4. Persistencia y modelo de datos
- Añadir una colección de entidades `Speaker` (o `Orator`, el equipo de desarrollo escogerá un nombre coherente y lo usará de forma consistente) al modelo del torneo:
  - `id: string`
  - `teamId: string`
  - `name: string`
- `teamId` debe referenciar un equipo existente. El backend debe validar esta referencia, el ID único y el nombre no vacío, además de los límites de longitud acordados.
- Integrar la entidad en todo el ciclo de lectura, validación y guardado del torneo y en la persistencia de Google Sheets, respetando los mecanismos existentes de control de concurrencia/revisión.
- Evitar que una petición antigua o un estado local obsoleto restaure un orador que ya se eliminó.
- No se debe introducir un refresco independiente más frecuente: las pantallas deben seguir utilizando el intervalo común de actualización (`DATA_REFRESH_INTERVAL_MS`), actualmente centralizado en `src/config.ts`.
- El cambio de esquema debe ser compatible con torneos que todavía no contengan la colección: la ausencia inicial se tratará como una lista vacía. No reinicializar ni borrar las pestañas de datos existentes como parte de esta funcionalidad.

### 5. Integridad referencial y borrado de equipos
- No se permitirá persistir un orador que apunte a un equipo inexistente.
- Si se elimina un equipo, sus oradores no pueden quedar como registros huérfanos. El comportamiento previsto es eliminarlos en la misma operación lógica de borrado del equipo, documentándolo y cubriéndolo con pruebas.
- Si la edición del equipo permite cambiar su nombre, los oradores conservarán sus IDs y asociación, porque se vinculan mediante `teamId`, no mediante el nombre del equipo.
- No añadir reglas que obliguen a que todos los equipos tengan un número concreto de oradores; en este requisito no existe un mínimo ni un máximo configurable.

### 6. Alcance explícitamente excluido
- Asignar un orador a cada fase/intervención del formato de debate.
- Sustituir de inmediato el campo de texto actual `Phase.speaker` por una relación con `Speaker`.
- Mostrar el nombre de un orador en los cronómetros públicos, resultados o informes.
- Crear perfiles globales de personas, compartir un orador entre varios equipos o añadir campos como apellidos, DNI, correo, universidad o teléfono.
- Imponer restricciones por rondas, incompatibilidades entre oradores o un número fijo de personas por equipo.

La exclusión es deliberada: actualmente las fases utilizan un texto `speaker` para describir la intervención. Las fases y rondas permanecen agnósticas a la identidad de las personas: su campo de interviniente describe el rol de la intervención (por ejemplo, “Equipo a favor”), no el nombre de un orador concreto. Los nombres se registran posteriormente desde Equipos según la información que reciba el gestor; esta PR no los asigna a fases.

## Criterios de aceptación

1. Al desplegar un equipo, se ve su lista de oradores y no la de otros equipos.
2. Se puede crear un orador con nombre válido; recibe un ID estable y se muestra en la lista de ese equipo.
3. El nombre vacío o compuesto únicamente por espacios se rechaza con un mensaje comprensible.
4. Tras un guardado correcto, el orador sigue presente tras recargar la aplicación y consultarla desde otra sesión/dispositivo conectado al mismo torneo.
5. Se puede eliminar un orador sin alterar los demás oradores ni el equipo.
6. Tras eliminarlo correctamente y recargar, el orador ya no aparece.
7. Un fallo de persistencia se comunica y no se muestra falsamente la operación como completada.
8. El backend rechaza IDs duplicados y referencias a equipos inexistentes.
9. El borrado de un equipo no deja oradores huérfanos.
10. Torneos anteriores sin colección de oradores siguen cargando con una lista vacía, sin perder equipos, jueces, instituciones, rondas, salas, formatos ni cronómetros.
11. Hay pruebas para validación, lectura/escritura, alta, borrado y limpieza referencial.
12. CI debe pasar `npm test`, `npm run typecheck:api` y `npm run build`.

## Consideraciones de implementación

- Seguir los patrones actuales de `Team`, `Judge`, `Tournament` y de las operaciones de persistencia del backend.
- Añadir pruebas de modelo/API y de la lógica de la interfaz que cubran persistencia y aislamiento entre equipos.
- No modificar la frecuencia de consulta a Google Sheets ni crear un polling por orador.
- No introducir migraciones destructivas. Si se requiere una nueva pestaña, crearla de forma aditiva y tolerar que la colección todavía no exista.
- Revisar si la API valida el torneo completo en cada guardado para garantizar que todos los IDs de `teamId` existen antes de escribir.
- Actualizar `PROJECT_SPEC.md` cuando la implementación se complete, no como sustituto de las pruebas.
