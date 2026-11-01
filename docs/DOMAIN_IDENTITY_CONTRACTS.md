# Contrato de identidad canónica — Fase 1

**Decisión de referencia:** [aplicación única](./ARCHITECTURE_DECISION_SINGLE_APPLICATION.md)  
**Implementación inicial:** `src/contracts/identity.ts`  
**Pruebas:** `src/contracts/identity.test.ts`

## Propósito

Gestión y Tabulación mantienen modelos especializados porque representan responsabilidades diferentes. No obstante, una misma entidad de negocio debe poder reconocerse sin depender del nombre visible, el orden de una lista o heurísticas.

Este contrato introduce una frontera explícita de identidad:
- `canonicalId`: identidad estable reconocida por la aplicación.
- `sourceId`: identificador con el que la entidad se representa en el modelo de origen.
- `kind`: tipo de entidad, para impedir intercambios accidentales de IDs.
- `source`: procedencia del registro (`manager`, `tabulation` o `legacy`).

Los IDs son opacos y preservan el valor original. Se validan como cadenas no vacías, de hasta 200 caracteres y sin caracteres de control. No se normalizan ni se regeneran automáticamente.

## Reglas obligatorias

1. El mapping explícito persistido es la única forma de resolver un ID local a uno canónico.
2. No se permite matching automático por nombre, institución, posición, similitud o coincidencia parcial.
3. Un mapping inexistente devuelve `null`; no crea ni vincula entidades.
4. Los DTOs externos se validan en runtime antes de confiar en ellos.
5. El tipo de entidad forma parte del contrato: un ID de juez no puede aceptarse como ID de equipo.
6. La identidad del torneo sigue siendo estable para trazabilidad e integridad, pero la aplicación solo opera un torneo activo.
7. Los modelos `Tournament` y `TabTournament` no se fusionan por introducir este contrato.
8. Los mappings históricos deben conservarse durante la transición y solo retirarse tras una migración/exportación comprobada.

## Tipos de entidad cubiertos

`tournament`, `institution`, `team`, `speaker`, `judge`, `physical-room`, `round`, `debate` y `assignment`.

## Propiedad y uso esperado

| Concepto | Propietario esperado | Uso |
|---|---|---|
| Identidad canónica de torneo | Núcleo de aplicación | Contexto único activo, auditoría e idempotencia |
| Instituciones, equipos, oradores y jueces | Gestión | Identidad y relaciones compartidas |
| Salas físicas y asignaciones oficiales | Gestión | Planificación operativa y vínculo con sala/debate |
| Rondas y debates | Núcleo de aplicación con publicación explícita | Borrador de Tabulación y publicación por Gestión |
| Papeletas, actas, resultados y clasificación | Tabulación | Modelo reglamentario especializado; referencias a IDs canónicos |
| IDs de origen | Adaptadores de cada módulo | Trazabilidad y compatibilidad durante la migración |

La matriz es el límite de propiedad objetivo, no una afirmación de que el código actual ya esté migrado a este contrato.

## Alcance de esta primera entrega

La implementación proporciona:
- tipos nominales de ID canónico y de origen;
- constructor validado de identidad;
- parser runtime para DTOs;
- resolución de mappings explícitos con comprobación de propiedad de clave;
- pruebas unitarias para entradas inválidas, IDs legacy, procedencia, inmutabilidad y ausencia de heurísticas.

**Todavía no está conectado a los modelos ni a los endpoints existentes.** Esta separación es deliberada: primero se fija el contrato, luego se migran adaptadores y consumidores de forma incremental con pruebas de caracterización. No se deben sustituir campos `string` en bloque ni hacer casts globales.

## Siguiente incremento

1. Inventariar y tipar los mappings actuales de equipos, jueces, oradores, salas y debates.
2. Definir DTOs versionados para snapshot compartido y publicación de ronda.
3. Adaptar un único flujo de lectura/escritura cada vez, comenzando por lectura de participantes.
4. Añadir tests de contrato que prueben ida/vuelta entre los modelos actuales sin pérdida de campos.
5. Solo después migrar los consumidores y retirar duplicaciones de identidad demostrablemente obsoletas.

No se permite eliminar datos o mappings ni ejecutar migraciones de producción como parte de este incremento.
