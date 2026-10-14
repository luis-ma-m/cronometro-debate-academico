# Propuesta funcional y técnica — Gestión de oradores

## 1. Objetivo

Permitir que la organización registre personas concretas que forman parte de cada equipo de debate. Los oradores se crean y gestionan desde la pestaña **Equipos**, asociados a un equipo y persistidos como entidades identificadas por ID, no como texto libre dentro de una intervención.

Esta propuesta documenta el alcance y la solución recomendada; no implementa todavía la funcionalidad.

## 2. Hallazgos de la exploración

La arquitectura actual es React + TypeScript + Vite, API serverless de Vercel y Google Sheets como persistencia, con Upstash Redis para bloqueo de escrituras y coordinación. El tipo `Team` actual contiene `id`, `name`, `institution` y `active`. El torneo se valida en el backend y se guarda desde un modelo completo; las pestañas se definen mediante `SHEET_HEADERS` en `api/core.ts` y se serializan desde `api/index.ts`.

La pantalla Equipos hoy permite editar nombre, institución y estado, así como eliminar un equipo. En Configuración, cada fase del formato guarda un campo textual `speaker` (“Quién interviene”). Ese campo es parte de una plantilla de formato y **no** representa una persona concreta: no debe convertirse automáticamente en un orador ni se debe inferir quién ha hablado a partir del cronómetro.

Referencias de la base actual:
- `src/domain.ts`: tipos `Team`, `Phase` y `Tournament`.
- `src/App.tsx`: pestaña Equipos y editor de fases de Configuración.
- `api/core.ts`: esquema de Sheets y validación del torneo.
- `api/index.ts`: carga y persistencia de pestañas en Google Sheets.
- `README.md`: arquitectura y esquema v2 actual.

## 3. Experiencia de usuario propuesta

### 3.1 Gestión dentro de Equipos

Cada fila o tarjeta de equipo tendrá una acción visible **Gestionar oradores**. Al activarla, se despliega debajo de ese equipo un panel vinculado inequívocamente a él; no se abre un catálogo global desconectado del equipo.

El panel muestra:
- Nombre del equipo.
- Lista ordenada de sus oradores.
- Campo para introducir el nombre de una persona y acción **Añadir orador**.
- Acción para editar el nombre de cada orador.
- Acción explícita para borrar un orador, con confirmación si ya existen referencias en datos de debates.
- Estado vacío comprensible cuando el equipo no tenga oradores.

Solo se desplegará un equipo a la vez para mantener compacta la pantalla. Cambiar de equipo desplegado no deberá descartar cambios pendientes del formulario. La lista podrá contener cualquier cantidad de oradores; no debe imponerse un máximo de tres salvo que un reglamento configurable futuro lo requiera.

### 3.2 Ciclo de vida e identidad

Cada orador tendrá un ID propio y estable, independiente del nombre. Cambiar el nombre no cambiará su identidad ni romperá las referencias que pudiera tener. La entidad se conserva al guardar el torneo y al recargar la web; solo se elimina mediante la acción de borrado en la pestaña Equipos.

Los nombres iguales entre equipos son válidos (puede haber homónimos). Como validación de calidad de datos, se recomienda impedir nombres vacíos y evitar duplicados tras quitar espacios exteriores y comparar sin distinguir mayúsculas dentro del mismo equipo. Esta validación no impide registrar personas con el mismo nombre en equipos diferentes.

### 3.3 Relación con el equipo

En la primera versión, cada orador pertenece a exactamente un equipo. No se propone mover oradores entre equipos en el MVP; si en el futuro se necesita transferirlos, deberá ser una acción explícita que valide las referencias existentes.

Al desactivar un equipo, sus oradores se conservarán y no podrán seleccionarse para nuevas asignaciones si más adelante se añade esa capacidad. La desactivación no equivale a borrado.

Al eliminar un equipo, la interfaz debe explicar qué ocurrirá con sus oradores. Recomendación: borrar en cascada los oradores de ese equipo, dado que no podrán existir como miembros de un equipo inexistente. Si se incorporan referencias históricas a esos oradores, el borrado en cascada no será admisible sin conservar una instantánea histórica o impedir el borrado.

## 4. Modelo de datos recomendado

Añadir una entidad `Speaker` en `src/domain.ts`:

```ts
export interface Speaker {
  id: string;
  teamId: string;
  name: string;
  // Opcional en el futuro: active, createdAt, updatedAt
}
```

Añadir `speakers: Speaker[]` al tipo `Tournament`.

### Persistencia en Google Sheets

Añadir una pestaña dedicada `Oradores` con columnas:

| Columna | Uso |
|---|---|
| `id` | Identificador persistente, único |
| `teamId` | ID del equipo propietario |
| `name` | Nombre visible del orador |

Añadir `Oradores` a `SHEET_HEADERS` y a los mapas de lectura/escritura. La relación se realizará exclusivamente con `teamId`, nunca con el nombre del equipo. Los datos del navegador de demostración también deben incluir `speakers`.

No recomiendo almacenar los oradores en una cadena JSON dentro de la fila de Equipos: separarlos como registros normalizados simplifica las validaciones, evita sobrescribir personas al editar otros datos del equipo y permite ampliar el modelo en el futuro.

### Migración del esquema

El esquema actual de producción declara v2 y la creación/migración de pestañas puede estar limitada a Production; el README advierte de una inicialización potencialmente destructiva cuando falta `schemaVersion=2`. Para esta funcionalidad, **no se debe reinicializar el torneo ni cambiar de versión mediante una migración destructiva**. La implementación debe incorporar la nueva pestaña con una migración aditiva que preserve las pestañas y filas actuales, escriba cabeceras solo si la pestaña nueva está vacía y sea idempotente. Hay que revisar el flujo de migración existente y garantizar que añadir `Oradores` no active la ruta de reinicialización destructiva de v2. Si el mecanismo actual no permite hacer esto de forma segura, corregirlo antes de desplegar.

## 5. Reglas de negocio y validación de backend

El backend debe rechazar el estado completo si:
1. `speakers` no es una lista.
2. Algún orador no tiene `id`, `teamId` o `name` válido.
3. Los IDs de orador están duplicados.
4. `teamId` referencia un equipo inexistente.
5. El nombre queda vacío, supera 200 caracteres o está duplicado dentro del equipo tras normalizar espacios y capitalización.
6. El payload no contiene el campo `speakers` por provenir de un cliente antiguo: durante compatibilidad/migración se debe normalizar a lista vacía, no borrar datos existentes de forma silenciosa.

Las validaciones de cliente son útiles para el feedback, pero no sustituyen las validaciones de servidor. Deben mantenerse el bloqueo compartido, el control de revisión y las respuestas de conflicto ya usados para escrituras del torneo.

## 6. Alcance de la primera versión

Incluido:
- Crear oradores desde el equipo elegido.
- Listar los oradores de ese equipo.
- Editar su nombre sin cambiar su ID.
- Borrar un orador desde el panel desplegable de Equipos.
- Persistencia real en Google Sheets y persistencia equivalente en modo demo.
- Estados de carga, guardado, error y cambios sin guardar coherentes con el flujo actual.
- Migración aditiva, idempotente y no destructiva.
- Tests de modelo/validación, serialización y UI.

No incluido:
- Asignar oradores automáticamente a una fase.
- Inferir identidad a partir del cronómetro.
- Registrar notas, puntuaciones, faltas o estadísticas personales.
- Mostrar la identidad del orador en las pantallas públicas.
- Vincular oradores con intervenciones del formato.
- Catálogo global de personas o pertenencia simultánea a varios equipos.

Estos temas pueden diseñarse después como funcionalidades separadas. En particular, para una fase futura de asignación de orador a una intervención se recomienda referenciar `speakerId` (ID) en la asignación concreta del debate, sin reemplazar el texto genérico `Phase.speaker` del preset.

## 7. Criterios de aceptación

1. En Equipos, al desplegar un equipo se ve únicamente la lista de oradores que tienen su `teamId`.
2. Se puede crear un orador con nombre válido y queda asociado al equipo seleccionado.
3. Un orador persiste tras guardar, recargar y recuperar el torneo desde Google Sheets.
4. Cambiar el nombre no modifica el ID del orador.
5. Dos equipos distintos pueden tener oradores con el mismo nombre; un mismo equipo no puede tener duplicados normalizados.
6. No se puede guardar un orador con un equipo inexistente ni un nombre vacío.
7. Borrar un orador no afecta a otros oradores ni a las asignaciones del equipo.
8. Borrar un equipo no deja oradores huérfanos; la interfaz comunica la consecuencia antes de confirmar.
9. El modo demo se comporta de forma equivalente a producción.
10. Añadir la pestaña Oradores conserva íntegros los datos de las pestañas actuales y repetir la migración no duplica cabeceras ni borra registros.
11. Los tests y la compilación del proyecto pasan.
12. La pantalla pública y las funciones del cronómetro siguen comportándose igual; no se introducen inferencias de orador ni se altera el temporizador.

## 8. Plan de implementación propuesto

1. Añadir el tipo `Speaker`, la colección del torneo y defaults compatibles.
2. Añadir la pestaña `Oradores` y serialización/deserialización de registros.
3. Revisar y probar la migración aditiva del esquema de producción antes de desplegar.
4. Extender la validación de backend con integridad referencial y duplicados por equipo.
5. Implementar el panel desplegable por equipo, formularios y borrado confirmado.
6. Adaptar el modo demo y los tipos/fixtures de tests.
7. Añadir tests de validación, persistencia/migración, operaciones CRUD y comportamiento de despliegue.
8. Ejecutar `npm test`, `npm run build` y la comprobación de bundle de la API.
9. Verificar en una copia/prueba de Sheets que los datos preexistentes se preservan antes de desplegar a Production.

## 9. Riesgos a vigilar

- **Migración destructiva accidental:** el riesgo más importante, dada la lógica documentada de inicialización del esquema v2.
- **Pérdida por edición concurrente:** conservar revisión, bloqueo y el patrón de guardado actual.
- **Oradores huérfanos:** validar `teamId` y definir la política de borrado del equipo.
- **Acoplamiento incorrecto al cronómetro:** los oradores son datos del gestor; el reloj no decide quién habla.
- **Borrado con referencias futuras:** si posteriormente se registran intervenciones por persona, habrá que impedir el borrado o mantener snapshots históricos.
