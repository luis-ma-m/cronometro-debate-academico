# Decisión arquitectónica: una aplicación, dos vertientes

- **Fecha de decisión:** 2026-10-31
- **Estado:** Decisión aprobada; documento vinculante para las siguientes fases de desarrollo
- **Ámbito:** Evolución del Gestor de Debate y Tabulación, incluida la integración iniciada en la PR #79
- **Rama de documentación:** `docs/architecture-pivot-single-app`
- **PR de referencia:** [#79 — Tabulación integrada con el gestor](https://github.com/luis-ma-m/cronometro-debate-academico/pull/79)

---

## 1. Decisión ejecutiva

A partir de esta fecha, el objetivo de producto y arquitectura es **una única aplicación de gestión de torneos de debate, con dos vertientes funcionales integradas**:

1. **Gestión y operación:** administración del torneo, participantes, jueces, instituciones, rondas oficiales, salas, cronómetros, puntuaciones y configuración.
2. **Competición y tabulación:** configuración reglamentaria, generación de emparejamientos, grupos y sistema suizo, asignación de jurados, actas, sanciones, clasificaciones, desempates y eliminatorias.

No se construirán dos aplicaciones independientes que necesiten sincronizarse entre sí como si fueran productos distintos. Tampoco se crearán microservicios ni se iniciará una reescritura completa. Se evolucionará el repositorio actual hacia una **aplicación modular única (monolito modular)**, con una experiencia coherente, límites de dominio explícitos y una única fuente oficial de datos.

Las dos vertientes pueden conservar navegación, pantallas, componentes y modelos de presentación especializados. Esa separación funcional no debe convertirse en una separación de producto, de identidad, de autoridad de datos ni en una integración distribuida entre dos aplicaciones.

Esta decisión sustituye cualquier propuesta anterior que plantee mantener dos aplicaciones independientes como arquitectura objetivo.

## 2. Alcance: un único torneo activo

El producto **no debe gestionar varios torneos simultáneamente**.

La aplicación se diseña para administrar un único torneo activo en cada instalación/entorno. En consecuencia:

- No se implementará multi-tenancy ni aislamiento entre múltiples torneos concurrentes.
- No se añadirán selectores, dashboards, permisos, repositorios o flujos orientados a alternar entre varios torneos activos.
- No se justificará complejidad arquitectónica por una hipotética operación multi-torneo.
- Las entidades, rondas, asignaciones, reglas, actas y resultados pertenecen al único torneo gestionado por la aplicación.
- La identidad estable del torneo puede mantenerse para integridad, idempotencia, enlaces y trazabilidad; **no implica soporte multi-torneo**.
- Se permite conservar identificadores locales o históricos cuando sean necesarios para compatibilidad, recuperación o trazabilidad. No deben convertirse en una abstracción de multi-tenancy.
- Cualquier código, tabla, índice, API, configuración, documentación o prueba cuyo único propósito sea soportar múltiples torneos concurrentes debe marcarse para deprecación y eliminación.

La eliminación se hará de forma controlada: primero se identifican dependencias y datos, después se simplifican contratos y finalmente se retiran migraciones/código cuando sea seguro. No se borrarán migraciones ya aplicadas ni se reescribirá el historial de esquema. Las simplificaciones de base de datos se implementarán mediante nuevas migraciones compatibles.

## 3. Principios arquitectónicos vinculantes

### 3.1 Una sola aplicación y una sola experiencia de producto

- Gestor y Tabulación son dos áreas funcionales de la misma aplicación.
- Deben compartir sesión, identidad de instalación/torneo, navegación, sistema de diseño, configuración, observabilidad y mecanismos de persistencia.
- El acceso a una vertiente no debe requerir una segunda aplicación, un segundo login ni una sincronización entre dos productos.
- Las áreas pueden tener rutas y layouts propios, pero forman parte del mismo despliegue y ciclo de vida.
- La aplicación debe ofrecer una transición clara entre gestión y tabulación sin duplicar el estado oficial.

### 3.2 Monolito modular, no microservicios

- Mantener un único backend desplegable y una única aplicación frontend.
- Organizar el código por módulos de negocio y contratos explícitos.
- No introducir comunicación HTTP interna entre módulos que conviven en el mismo proceso.
- Los límites de módulo se expresan mediante interfaces, servicios de aplicación y dependencias dirigidas; no mediante servicios desplegados por separado.
- Extraer un servicio independiente solo podría reconsiderarse ante una necesidad operativa demostrada y una decisión arquitectónica posterior.

### 3.3 Una única fuente oficial de datos

PostgreSQL/Neon es la fuente persistente oficial del estado del torneo. El navegador puede mantener copias locales y operaciones pendientes para resiliencia, pero estas no constituyen una segunda autoridad.

- El gestor y Tabulación consultan y modifican el mismo dominio oficial mediante servicios y contratos internos de la aplicación.
- La autoridad de cada dato se define en el apartado 5.
- Los cambios locales no confirmados se identifican claramente como borradores o pendientes.
- Ninguna proyección o caché sustituye a la fuente oficial.
- La indisponibilidad del backend no debe inutilizar la operativa local que se haya definido como resiliente/offline.

### 3.4 Separar dominio, aplicación, infraestructura y presentación

Las reglas de negocio no deben residir en componentes React, handlers HTTP, adaptadores de almacenamiento ni lógica de sincronización.

Cada módulo debe distinguir, según proceda:

- **Dominio:** entidades, invariantes, políticas y cálculos.
- **Aplicación:** casos de uso y coordinación de operaciones.
- **Contratos:** DTOs, esquemas y límites entre módulos.
- **Infraestructura:** PostgreSQL, Redis, IndexedDB, APIs y adaptadores.
- **Presentación:** pantallas, componentes y estado de interfaz.

No es obligatorio crear una jerarquía de carpetas artificial para cada módulo pequeño. Sí es obligatorio mantener dependencias claras y evitar que la interfaz o la infraestructura sean la fuente de las reglas.

### 3.5 Conservar los modelos especializados cuando representen conceptos distintos

No se exige que el modelo operativo del gestor y el modelo reglamentario de Tabulación sean idénticos. Por ejemplo, un juez operativo y un juez de tabulación pueden tener atributos y comportamientos especializados.

La solución debe compartir identidad, relaciones y contratos canónicos, y utilizar adaptadores tipados donde las representaciones sean diferentes. Se prohíben las conversiones implícitas, los casts de payloads no validados y los emparejamientos automáticos basados exclusivamente en nombres.

### 3.6 Resiliencia local con confirmación explícita

- La operativa local que deba sobrevivir a caídas de red se conserva.
- IndexedDB puede almacenar estado local y operaciones duraderas; localStorage se reserva para preferencias o datos pequeños que no requieran garantías transaccionales.
- Las operaciones pendientes solo se consideran confirmadas tras un ACK verificable del backend.
- Los reintentos deben ser idempotentes y recuperar timeouts ambiguos con el mismo identificador de operación.
- Los conflictos no se resuelven mediante last-write-wins silencioso.
- El guardado local y la creación de la operación pendiente deben tener una garantía atómica o un mecanismo de recuperación probado que impida perder cambios.
- La sincronización pasa a ser un mecanismo de persistencia y recuperación de la aplicación única, no un puente entre dos aplicaciones autónomas.

## 4. Módulos funcionales objetivo

La organización final debe responder a responsabilidades de negocio. Los nombres son orientativos; no obligan a mover todos los archivos en una sola fase.

| Módulo | Responsabilidad principal |
|---|---|
| Torneo | Identidad, configuración general y ciclo de vida del único torneo |
| Participantes | Equipos, oradores, jueces e instituciones |
| Espacios y salas | Salas físicas, asignaciones operativas y estado de sala |
| Rondas | Rondas, debates, emparejamientos y publicación |
| Tabulación | Reglas, presets, grupos, suizo, eliminatorias y progresión |
| Adjudicación | Jurados, presidencias, incompatibilidades y disponibilidad |
| Puntuación y actas | Papeletas, actas conjuntas, sanciones, resultados y versiones |
| Clasificación | Rankings, desempates, break y proyecciones |
| Cronómetro | Control de sala, fases, revisiones y continuidad offline |
| Identidad y acceso | Sesión, autorización y permisos de operación |
| Persistencia y auditoría | Repositorios, historial, eventos y trazabilidad |
| Sincronización local | Outbox, leases, reintentos, conflictos y recuperación |

Los módulos deben comunicarse mediante interfaces tipadas. No deben importar libremente detalles internos de otros módulos ni acceder directamente a sus tablas desde cualquier parte de la aplicación.

## 5. Autoridad y propiedad de los datos

La aplicación es única, pero cada dato debe tener un propietario funcional inequívoco.

| Dato | Módulo propietario | Regla |
|---|---|---|
| Identidad y configuración general del torneo | Torneo | Una única configuración oficial |
| Equipos e instituciones | Participantes | Una única identidad por entidad |
| Oradores y pertenencia a equipos | Participantes | Relaciones validadas y trazables |
| Jueces e incompatibilidades | Participantes / Adjudicación | Datos comunes con atributos especializados |
| Salas físicas | Espacios y salas | Una única definición oficial |
| Rondas y asignaciones | Rondas | Los borradores no alteran asignaciones oficiales |
| Reglas de tabulación | Tabulación | Un único editor oficial dentro de Configuración |
| Actas y papeletas | Puntuación y actas | Se preserva el contenido original y su semántica |
| Resultados oficiales | Puntuación y actas | Solo se publican tras validación y confirmación |
| Clasificaciones | Clasificación / Tabulación | Cálculo reglamentario único; otras vistas son proyecciones |
| Estado del cronómetro | Cronómetro | Operación resiliente con control de concurrencia |
| Operaciones no confirmadas | Sincronización local | Nunca se presentan como persistidas oficialmente |

La interfaz de gestión puede presentar y operar datos calculados por Tabulación. No debe implementar una segunda versión simplificada de las reglas de clasificación.

## 6. Requisitos no negociables de integración

1. **Una identidad:** no deben existir dos identidades de torneo independientes para Gestor y Tabulación.
2. **Un único editor de reglas:** las reglas se administran desde Configuración de la aplicación; cualquier vista especializada es de consulta o delega en ese flujo.
3. **Una única fuente de participantes:** los cambios en equipos, oradores y jueces se reflejan en las dos vertientes sin sincronización manual entre productos.
4. **Publicación controlada:** un sorteo o ronda en borrador no se convierte en asignación oficial hasta que el caso de uso de publicación lo confirme.
5. **Actas fieles:** deben conservarse papeletas individuales, actas conjuntas, rúbricas, sanciones, notas, oradores, ganador declarado y snapshot de reglas.
6. **Historial inmutable:** una sustitución de acta crea una nueva versión vinculada a la anterior; nunca sobrescribe destructivamente la fuente histórica.
7. **Idempotencia:** los reintentos no duplican rondas, asignaciones, actas, enlaces ni eventos.
8. **Concurrencia:** dos operadores o dispositivos no pueden sobrescribir cambios incompatibles silenciosamente.
9. **Offline:** la caída de API, Redis o red no debe detener el cronómetro local ni destruir actas o cambios locales pendientes.
10. **Trazabilidad:** las operaciones relevantes registran actor, instante, alcance, revisión y resultado sin exponer secretos ni datos innecesarios.
11. **Validación de servidor:** toda operación que afecte a resultados oficiales se valida en backend; el cliente no puede declarar autoritativo un resultado.
12. **Compatibilidad:** los enlaces de actas y formatos autocontenidos ya desplegados deben seguir resolviéndose durante la transición.

## 7. Tratamiento de la PR #79

La PR #79 es una fuente de implementación reutilizable, no una arquitectura que deba aceptarse íntegramente.

Se aplicarán estas decisiones:

### Conservar, sujeto a revisión y pruebas

- Historial inmutable de fuentes de actas y su puntero a versión vigente.
- Snapshot de reglas asociado a cada acta.
- Publicación explícita de rondas y asignaciones.
- Idempotencia y validación de operaciones.
- Outbox duradera, leases, backoff y recuperación.
- Enlaces cortos de ocho caracteres, revocación, caducidad y auditoría.
- Compatibilidad de enlaces autocontenidos.
- Reglas de tabulación versionadas.
- Pruebas de dominio y de regresión que sigan siendo válidas.

### Adaptar o simplificar

- `panelBridge.ts`: convertirlo en adaptador temporal de compatibilidad y retirar el handoff entre aplicaciones cuando los flujos compartan directamente contratos y servicios.
- `reconciliation.ts` y `panelSync.ts`: reutilizar políticas y pruebas útiles, pero sustituir la reconciliación entre productos por casos de uso internos de actualización y resolución de conflictos.
- Mapeos de identidad: mantener solo los necesarios para compatibilidad histórica y migración; no sostener dos identidades canónicas.
- `App.tsx`: extraer casos de uso y estado de negocio a módulos; los componentes coordinan presentación.
- DTOs: normalizar contratos internos versionados y validarlos en los límites de entrada.

### Deprecar y eliminar

- El concepto de dos aplicaciones autónomas que se sincronizan.
- Handoffs persistidos cuyo único propósito sea transferir snapshots entre ambas aplicaciones.
- Flujos de vinculación manual entre un torneo local de Tabulación y un torneo remoto del Gestor.
- Soporte de múltiples torneos concurrentes o multi-tenancy.
- Selectores y estructuras de navegación orientados a varios torneos.
- Código, columnas, tablas, APIs, índices y pruebas cuya única finalidad sea distinguir múltiples torneos activos.
- Duplicación de sesiones, autoridad de reglas, catálogos de participantes o estados oficiales.

La retirada se hará después de localizar usos, compatibilidades y dependencias. Las migraciones históricas no se editarán si ya pueden haberse aplicado; se añadirán migraciones posteriores y seguras.

## 8. Arquitectura de referencia del repositorio

La estructura puede evolucionar progresivamente hacia una organización similar a:

```text
src/
  app/
    navigation/
    gestor/
    tabulacion/

  modules/
    tournament/
    participants/
    rooms/
    rounds/
    adjudication/
    tabulation/
    scoring/
    actas/
    rankings/
    timer/
    identity/

  shared/
    contracts/
    design-system/
    persistence/
    synchronization/
    observability/

server/
  modules/
    tournament/
    participants/
    rooms/
    rounds/
    adjudication/
    tabulation/
    scoring/
    actas/
    rankings/
    timer/
    identity/

  infrastructure/
    postgres/
    redis/
    auth/
    audit/
```

Esta estructura es una referencia, no una orden de mover todo el repositorio de una vez. Se priorizarán límites de dependencia y pruebas sobre la reorganización cosmética de carpetas.

## 9. Fases de desarrollo y criterios de salida

Cada fase debe implementarse en PRs pequeñas, revisables y con criterios de aceptación verificables. No se considerará terminada por haber añadido código o documentación: debe existir evidencia de pruebas.

### Fase 0 — Baseline y mapa de dependencias

**Objetivo:** conocer qué existe y proteger lo que ya funciona.

Requisitos:
- Inventariar módulos, entradas de API, modelos, tablas, migraciones, almacenamiento local y flujos de usuario.
- Trazar dependencias entre Gestor, Tabulación y PR #79.
- Clasificar archivos: conservar, adaptar, sustituir o retirar.
- Identificar rutas críticas: cronómetro, participantes, ronda, acta, clasificación y short links.
- Registrar pruebas actuales y huecos de cobertura.

**Salida:** inventario aprobado, mapa de dependencias, matriz de reutilización y baseline de pruebas reproducible.

### Fase 1 — Contratos y núcleo de dominio

**Objetivo:** fijar los límites de la aplicación única.

Requisitos:
- Definir identidad única del torneo activo.
- Definir contratos canónicos para equipos, oradores, jueces, salas, rondas, debates y asignaciones.
- Separar modelos de dominio de DTOs y modelos de interfaz.
- Definir propietarios y operaciones permitidas por módulo.
- Establecer validación runtime en entradas externas.
- Eliminar nuevas abstracciones multi-torneo de los diseños y contratos.

**Salida:** contratos versionados, diagramas de dependencias y pruebas de invariantes del dominio.

### Fase 2 — Unificación de experiencia y aplicación

**Objetivo:** hacer que Gestor y Tabulación funcionen como vertientes de un único producto.

Requisitos:
- Navegación, sesión, identidad y configuración comunes.
- Acceso a ambas vertientes dentro de la misma aplicación y despliegue.
- Eliminar login o vínculo independiente entre las vertientes.
- Compartir catálogos e identidades de participantes.
- Mantener pantallas especializadas cuando aporten valor.
- Evitar que la transición entre áreas pierda estado o cree copias divergentes.

**Salida:** recorrido completo de usuario sin handoff ni vinculación manual entre aplicaciones.

### Fase 3 — Modularización del backend y frontend

**Objetivo:** separar responsabilidades sin cambiar innecesariamente el comportamiento.

Requisitos:
- Extraer lógica de negocio de componentes React y del dispatcher API.
- Implementar servicios de aplicación por módulo.
- Definir repositorios e interfaces de persistencia.
- Evitar dependencias circulares y accesos directos a tablas fuera del módulo propietario.
- Mantener un único backend desplegable.
- Añadir pruebas de contrato y de integración entre módulos.

**Salida:** módulos con dependencias documentadas, pruebas y comportamiento funcional equivalente.

### Fase 4 — Persistencia y resiliencia local

**Objetivo:** garantizar que el trabajo local no se pierde ni se confirma falsamente.

Requisitos:
- Definir qué datos se persisten localmente y con qué garantías.
- Preferir IndexedDB para datos y operaciones duraderas.
- Hacer atómica la modificación local y el registro de su operación pendiente, o demostrar una recuperación equivalente ante cierre abrupto.
- Unificar outbox y worker donde existan duplicidades.
- Probar leases, pestañas, dispositivos, backoff, conflictos y timeouts ambiguos.
- Confirmar operaciones solo tras ACK del servidor.
- Mantener el cronómetro operativo sin dependencia de la disponibilidad de la sincronización general.

**Salida:** pruebas automatizadas y E2E de recuperación, concurrencia y modo offline.

### Fase 5 — Rondas, actas y resultados oficiales

**Objetivo:** cerrar el circuito funcional de competición.

Requisitos:
- Generar y publicar rondas mediante un caso de uso único.
- Validar equipos, jueces, incompatibilidades, presidencia, salas y posturas en servidor.
- Guardar actas individuales, conjuntas y de eliminatorias sin pérdida semántica.
- Mantener historial inmutable, sustitución confirmada, auditoría e idempotencia.
- Calcular clasificaciones y desempates desde una única implementación reglamentaria.
- Mostrar las proyecciones correctas en las vistas de gestión.
- Preservar compatibilidad y control de los short links.

**Salida:** recorridos completos y transaccionales para grupos, suizo, eliminatorias, actas y clasificación.

### Fase 6 — Retirada de arquitectura anterior

**Objetivo:** eliminar complejidad que ya no tiene razón de existir.

Requisitos:
- Retirar handoffs y reconciliación entre aplicaciones.
- Eliminar soporte multi-torneo y multi-tenancy no requerido.
- Eliminar adaptadores y DTOs redundantes.
- Simplificar esquema y APIs mediante migraciones seguras.
- Eliminar estados duplicados y fuentes de verdad alternativas.
- Actualizar documentación, pruebas y observabilidad.

**Salida:** ninguna ruta de producción depende de la arquitectura de dos aplicaciones independientes ni de soporte multi-torneo.

### Fase 7 — Validación production-ready

**Objetivo:** demostrar que la aplicación única es segura y operable.

Requisitos:
- Aplicar migraciones en entorno Preview aislado y validar desde los esquemas de origen soportados.
- Probar transacciones y constraints contra PostgreSQL real.
- Probar sesiones, autorización y aislamiento de operaciones.
- Probar dos dispositivos, pérdida de red, recuperación y concurrencia.
- Ejecutar E2E de todos los recorridos críticos.
- Verificar logs, métricas, alertas y ausencia de secretos en registros.
- Confirmar rollback operativo y compatibilidad de datos.
- No ejecutar pruebas destructivas contra Production.

**Salida:** checklist de aceptación completo con evidencia reproducible y aprobación explícita antes de retirar el estado Draft de la PR de implementación correspondiente.

## 10. Estrategia de transición y seguridad

- No se autoriza una reescritura completa por defecto.
- No se eliminará funcionalidad que ya esté en uso sin sustituto probado.
- Cada refactorización debe preservar comportamiento o documentar expresamente el cambio aprobado.
- Las migraciones son append-only; no se modifican scripts que puedan haberse aplicado.
- Los datos históricos y las actas no se borran como consecuencia de simplificar el modelo.
- Las migraciones que retiren estructuras multi-torneo deben demostrar primero que no contienen datos necesarios y que no existen referencias activas.
- No se ejecutarán migraciones, escrituras de prueba ni operaciones destructivas contra Neon Production.
- Los límites de deployment o cuota de Vercel son restricciones operativas; no justifican introducir cambios arquitectónicos de emergencia.
- La PR #79 permanece en Draft hasta que la nueva arquitectura y sus criterios de aceptación estén implementados y validados.

## 11. Criterios globales de aceptación

La evolución se considerará completada cuando se cumpla todo lo siguiente:

- [ ] Existe una única aplicación con dos vertientes funcionales: Gestión y Tabulación.
- [ ] Ambas vertientes comparten sesión, identidad, navegación, configuración y fuente oficial de datos.
- [ ] No existe sincronización entre dos aplicaciones autónomas.
- [ ] El sistema gestiona un único torneo activo; no existe soporte multi-torneo innecesario.
- [ ] Los módulos tienen responsabilidades y dependencias explícitas.
- [ ] Los participantes y sus identidades son comunes.
- [ ] Las reglas se editan en un único lugar.
- [ ] Rondas y asignaciones se publican mediante operaciones validadas.
- [ ] Actas individuales, conjuntas y de eliminatorias conservan su semántica e historial.
- [ ] Clasificaciones y desempates tienen una única implementación autoritativa.
- [ ] La persistencia local y la outbox no pierden operaciones.
- [ ] El cronómetro conserva su autonomía operativa.
- [ ] Los reintentos son idempotentes y los conflictos visibles.
- [ ] Short links y formatos autocontenidos mantienen compatibilidad.
- [ ] Las pruebas de integración se han ejecutado contra PostgreSQL real en Preview.
- [ ] Se han probado los recorridos críticos en navegador y con dos dispositivos.
- [ ] No quedan dependencias de producción respecto al bridge entre aplicaciones ni a abstracciones multi-torneo.

## 12. Gobierno de esta decisión

Este documento registra la decisión tomada el **31 de octubre de 2026** y será la referencia para diseñar fases, requisitos, tareas y criterios de aceptación.

Reglas de mantenimiento:

1. Los nuevos documentos de fase deben enlazar esta decisión y no redefinir la arquitectura por separado.
2. Los requisitos funcionales aprobados previamente siguen vigentes salvo contradicción explícita con esta decisión.
3. Si una implementación existente contradice este documento, se documentará como deuda o compatibilidad temporal; no se elevará automáticamente a requisito arquitectónico.
4. Cualquier excepción requiere una decisión explícita, con motivo, impacto y plan de retirada si es temporal.
5. Las fases deben mantener trazabilidad entre decisión, requisito, implementación, pruebas y evidencia.
6. La documentación no sustituye a las pruebas ni autoriza por sí misma cambios destructivos.

**Decisión final:** evolucionar el producto actual hacia una única aplicación modular de gestión de torneos de debate, con dos vertientes integradas —Gestión y Tabulación—, una única autoridad de datos, resiliencia local y sin soporte para múltiples torneos simultáneos.
