# Requisitos de desarrollo: incompatibilidades en LEDU Control

- **Proyecto:** `luis-ma-m/cronometro-debate-academico`
- **Tipo:** especificación funcional y técnica para desarrollo
- **Estado:** pendiente de implementación
- **Alcance:** incompatibilidades institucionales, equipo–juez y juez–juez

## 1. Objetivo

Ampliar LEDU Control para que el organizador pueda configurar incompatibilidades individuales desde las pestañas **Equipos** y **Jueces**, y para que el sistema impida que una sala tenga una combinación de equipos y jueces incompatible.

Las incompatibilidades institucionales actuales deben mantenerse como regla general. La implementación debe funcionar en modo de demostración y en producción, con validación tanto en frontend como en backend.

Este documento define requisitos; no autoriza a dar por implementada ninguna funcionalidad sin código, pruebas y verificación del despliegue.

## 2. Reglas de negocio

### 2.1. Institución ↔ juez/equipo

- Mantener el comportamiento institucional existente: un juez no puede juzgar una sala en la que participe un equipo de su misma institución.
- La comprobación debe aplicarse a los equipos a favor y en contra.
- La regla institucional es general y no requiere configurar cada pareja individualmente.
- No sustituir ni debilitar esta regla al introducir incompatibilidades específicas.

### 2.2. Equipo ↔ juez

- Cada equipo podrá tener cero o más jueces incompatibles.
- Si un juez está en la lista de incompatibilidades de cualquiera de los dos equipos de una sala, no podrá formar parte del panel de esa sala.
- La incompatibilidad se basa en IDs estables, no en nombres visibles.
- La incompatibilidad no implica que el juez o el equipo estén inactivos ni impide asignarlos a salas donde no exista conflicto.

### 2.3. Juez ↔ juez

- Cada juez podrá tener cero o más jueces incompatibles.
- Dos jueces incompatibles no podrán coincidir en el panel de una misma sala.
- La regla es simétrica: si A es incompatible con B, B debe aparecer como incompatible con A. No debe ser necesario crear manualmente dos relaciones independientes.
- El resultado no debe depender del orden en el que se seleccionen los jueces.
- La regla afecta a una misma sala, no a la ronda completa. Dos jueces incompatibles pueden juzgar simultáneamente en salas distintas de la misma ronda.
- Un juez no puede seleccionarse a sí mismo como incompatible.

### 2.4. Combinación de reglas

- Las tres clases de incompatibilidad se aplican conjuntamente.
- Una sala debe evaluarse considerando los dos equipos y todas las parejas de jueces de su panel.
- Deben detectarse y comunicarse todos los conflictos relevantes, no solo el primero.
- Una incompatibilidad específica no elimina ni anula una incompatibilidad institucional.
- No se deben crear incompatibilidades automáticamente por compartir o no compartir institución.

## 3. Requisitos de interfaz

### 3.1. Pestaña Equipos

- Añadir una columna o control denominado **Jueces incompatibles**.
- Permitir abrir un diálogo o selector múltiple para buscar, seleccionar y retirar jueces.
- Mostrar los jueces seleccionados con nombres legibles y permitir eliminarlos individualmente.
- Mostrar un resumen compacto en la tabla cuando haya incompatibilidades configuradas.
- No incluir al juez como opción si está inactivo para nuevas asignaciones, salvo que sea necesario mostrar una relación ya existente; las relaciones existentes no deben desaparecer silenciosamente.
- Guardar las modificaciones usando el mecanismo de guardado y control de revisiones existente.

### 3.2. Pestaña Jueces

- Añadir una columna o control denominado **Jueces incompatibles**.
- Permitir seleccionar varios jueces mediante búsqueda.
- Excluir al propio juez de las opciones seleccionables.
- Mostrar las relaciones de manera recíproca. Si se modifica una pareja desde cualquiera de sus dos jueces, ambos registros y ambas vistas deben quedar consistentes.
- Permitir retirar una incompatibilidad sin afectar a otras relaciones del mismo juez.

### 3.3. Asignación de salas

- En la pestaña **Rondas y salas**, identificar los jueces que entren en conflicto con cualquiera de los equipos asignados.
- Identificar los jueces que entren en conflicto con otro miembro del panel.
- Deshabilitar la selección de una nueva asignación incompatible y mostrar un motivo comprensible.
- Preferir mostrar las opciones conflictivas deshabilitadas en lugar de ocultarlas, para que el organizador entienda el bloqueo.
- Recalcular las opciones cuando se cambie un equipo o se añada/retire un juez.
- Si se cambia un juez ya seleccionado por otro, comprobar el panel completo resultante.
- No cambiar ni retirar automáticamente asignaciones ya existentes al editar una regla.

### 3.4. Incidencias existentes

- Si se configura una incompatibilidad que afecta a una asignación guardada, mostrar una incidencia que identifique sala, equipo(s), juez(es) y tipo de conflicto.
- Impedir que se guarde una configuración nueva que mantenga incompatibilidades.
- Dar al organizador información suficiente para resolver el problema manualmente.
- No expulsar jueces de salas ni modificar paneles de forma automática, especialmente si la ronda está activa.

## 4. Modelo de datos

Ampliar los tipos de dominio de equipo y juez con listas de IDs:

- `Team.incompatibleJudgeIds: string[]`: IDs de jueces incompatibles con el equipo.
- `Judge.incompatibleJudgeIds: string[]`: IDs de jueces incompatibles con ese juez.

Las propiedades pueden ser opcionales en la capa de compatibilidad durante la transición, pero el modelo normalizado de la aplicación debe tratarlas como listas, usando `[]` cuando no haya incompatibilidades.

Requisitos de integridad:

- Los IDs deben referenciar entidades existentes.
- No guardar IDs duplicados dentro de una lista.
- No permitir referencias a jueces inexistentes.
- No permitir autorreferencias en incompatibilidades juez–juez.
- Normalizar las incompatibilidades juez–juez como relaciones recíprocas al editar o guardar.
- Al eliminar un equipo o juez, limpiar todas las referencias a sus IDs en los demás registros.
- Renombrar una entidad no debe romper sus incompatibilidades.

## 5. Persistencia y migración

La fuente de verdad de los datos del torneo sigue siendo Google Sheets. No añadir dependencias ni servicios externos para esta funcionalidad.

### 5.1. Google Sheets

Persistir las nuevas listas en las pestañas existentes:

- `Equipos`: columna `incompatibleJudgeIds`, serializada como JSON.
- `Jueces`: columna `incompatibleJudgeIds`, serializada como JSON.

Actualizar lectura, normalización, validación y serialización en el backend. Mantener el comportamiento correcto ante celdas vacías, JSON inválido o datos antiguos sin esos campos.

### 5.2. Migración destructiva autorizada

**Se autoriza expresamente que la migración sea destructiva.** No es requisito preservar los datos actuales de la hoja del torneo ni convertirlos si eso complica innecesariamente la migración.

El implementador puede incrementar la versión del esquema y reinicializar las pestañas de datos para establecer un esquema limpio compatible con los nuevos campos, siempre que:

- La migración sea explícita, determinista y esté documentada.
- La inicialización cree todas las pestañas y encabezados requeridos por la versión nueva.
- Se creen los datos iniciales necesarios para que el gestor arranque, incluidas la ronda inicial y el formato predeterminado si forman parte del bootstrap actual.
- Se mantenga la protección existente que impide ejecutar una migración destructiva desde Preview contra la hoja compartida de producción.
- La migración no se ejecute repetidamente en cada petición una vez que el esquema ya esté actualizado.
- La comprobación de versión y el resultado de la migración sean claros y verificables.

No es necesario implementar una migración que preserve o convierta los registros del esquema anterior. No obstante, la autorización de migración destructiva no permite borrar datos en cada despliegue ni eliminar la protección entre entornos.

## 6. Validación técnica

### 6.1. Fuente única de reglas

Implementar la lógica de conflictos en una función de dominio reutilizable. El frontend y el backend deben usar la misma semántica, evitando reglas duplicadas que diverjan.

La validación debe poder devolver conflictos estructurados con tipo y los IDs implicados, al menos para:

- Institución.
- Equipo–juez.
- Juez–juez.

### 6.2. Frontend

- Ampliar la validación actual de asignaciones para detectar los tres tipos.
- Mostrar avisos claros y accionables.
- Mantener consistentes los selectores de jueces al cambiar equipos o integrantes del panel.
- Mantener la misma lógica en modo demo y modo API.
- Evitar que la actualización periódica del estado remoto descarte ediciones locales sin guardar.

### 6.3. Backend

- Extender la validación autoritativa que se ejecuta al guardar el torneo.
- Rechazar peticiones directas o manipuladas que intenten guardar una asignación incompatible, aunque el frontend no la haya bloqueado.
- Validar referencias, listas y reciprocidad de las incompatibilidades juez–juez.
- Conservar el control de revisiones, el bloqueo distribuido de escrituras y el mecanismo de persistencia por lotes existentes.
- Devolver errores comprensibles y sin filtrar secretos.
- No cambiar el comportamiento de cronómetros, sesiones ni enlaces públicos de control.

## 7. Archivos y áreas previsibles

La implementación debe confirmar los puntos de integración en el código actual. Se prevén cambios en:

- `src/domain.ts`: tipos `Team` y `Judge`.
- `src/App.tsx`: edición de incompatibilidades, avisos y selección de jueces en salas.
- `src/timer.ts`: validación de asignaciones en cliente.
- `api/core.ts`: normalización, persistencia tabular y validación de servidor.
- `api/index.ts`: encabezados, lectura/escritura y versión del esquema de Google Sheets.
- `api/core.test.ts`: pruebas unitarias del backend.
- `src/demo.ts` y pruebas del frontend, si corresponde: datos de demostración y regresión.
- Documentación de despliegue: nueva versión del esquema y procedimiento de inicialización.

La lista es orientativa; no se deben crear abstracciones o modificar archivos que no sean necesarios.

## 8. Pruebas obligatorias

### 8.1. Pruebas de reglas

1. Un juez de la misma institución que cualquiera de los equipos no puede ser asignado.
2. Un juez incompatible con el equipo a favor no puede ser asignado.
3. Un juez incompatible con el equipo en contra no puede ser asignado.
4. Dos jueces incompatibles no pueden coincidir en una sala.
5. La incompatibilidad juez–juez funciona en ambos órdenes.
6. Una incompatibilidad no bloquea a los jueces en salas distintas de la misma ronda.
7. Se detectan varios conflictos en una misma sala.
8. Las listas vacías no alteran el comportamiento previo.
9. Se rechazan IDs inexistentes, duplicados y autorreferencias.
10. Editar una relación juez–juez desde cualquiera de los dos lados mantiene la reciprocidad.
11. Eliminar una entidad limpia sus referencias.
12. Cambiar nombres no rompe las relaciones.

### 8.2. Persistencia y API

1. Leer registros sin las columnas nuevas y normalizarlos de forma segura.
2. Guardar y recargar incompatibilidades desde Google Sheets.
3. Rechazar desde el backend una asignación conflictiva enviada directamente.
4. Mantener el control de revisiones y la protección ante escrituras concurrentes.
5. Verificar que la migración inicializa el esquema nuevo una sola vez.
6. Verificar que Preview no ejecuta la migración destructiva sobre la hoja de Production.
7. Confirmar que los datos demo soportan la nueva estructura.

### 8.3. Comandos de verificación

Ejecutar los comandos vigentes del repositorio, como mínimo:

- `npm test`
- `npm run build`
- `npx esbuild api/index.ts --bundle --platform=node --format=esm --outfile=/tmp/ledu-api-check.mjs`

Si existen pruebas de tipos, lint o integración adicionales configuradas en CI, también deben ejecutarse.

## 9. Criterios de aceptación

La funcionalidad solo se considera terminada cuando:

- [ ] Se pueden configurar jueces incompatibles desde cada equipo.
- [ ] Se pueden configurar jueces incompatibles desde cada juez.
- [ ] Las incompatibilidades juez–juez se muestran y guardan recíprocamente.
- [ ] Las reglas institucionales existentes siguen funcionando.
- [ ] La selección de jueces en sala comunica y bloquea los conflictos.
- [ ] El backend rechaza las asignaciones incompatibles independientemente del frontend.
- [ ] Las incidencias previas se muestran sin cambiar automáticamente los paneles.
- [ ] Google Sheets persiste las relaciones y el modo demo funciona.
- [ ] La migración destructiva autorizada está versionada, documentada y protegida entre entornos.
- [ ] Las pruebas obligatorias y los comandos de compilación pasan.
- [ ] No se han introducido cambios ajenos al alcance ni se han modificado las reglas de cronómetros.

## 10. Fuera de alcance

- Impedir que jueces incompatibles estén en salas distintas de una misma ronda.
- Eliminar automáticamente jueces de paneles ya asignados.
- Crear una pestaña independiente de administración global de incompatibilidades.
- Añadir proveedores, servicios o dependencias externas.
- Rediseñar las instituciones o reemplazar su regla actual.
- Cambiar la lógica de rondas, cronómetros, autenticación o enlaces de control salvo lo estrictamente necesario para integrar la validación.

## 11. Entrega esperada

La implementación debe entregarse en una PR acotada que incluya código, pruebas y actualización de documentación. La descripción de la PR debe indicar:

- Qué requisitos se han implementado.
- Qué versión de esquema se utiliza y qué datos reinicializa la migración.
- Resultados de pruebas y compilación.
- Cualquier desviación respecto a este documento.

No se debe afirmar que el despliegue real está validado únicamente porque pasen las pruebas locales o CI; la verificación de la hoja y del entorno de Vercel debe documentarse por separado.
