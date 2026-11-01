# Trazabilidad de PR #79 con el pivote de aplicación única

**Decisión vinculante:** `docs/ARCHITECTURE_DECISION_SINGLE_APPLICATION.md` (PR #83).  
**Base funcional:** [PR #79](https://github.com/luis-ma-m/cronometro-debate-academico/pull/79).  
**Implementación de contratos:** [PR #84](https://github.com/luis-ma-m/cronometro-debate-academico/pull/84).

Este documento evita que el pivote se interprete como una cancelación o una reescritura de la PR #79. Los requisitos funcionales de integración siguen vigentes; cambia su arquitectura de destino: dejan de ser sincronización entre dos aplicaciones autónomas y pasan a ser capacidades de una aplicación modular con dos áreas funcionales.

## 1. Reglas de interpretación

1. Ningún requisito funcional de PR #79 se considera descartado por no aparecer todavía en PR #84.
2. La PR #79 es la base de código y comportamiento que se debe inventariar, preservar y adaptar; no se debe fusionar automáticamente ni tratar como arquitectura final.
3. No se duplicarán implementaciones: cuando el pivote defina un propietario y un caso de uso común, los mecanismos anteriores se integrarán o retirarán de forma gradual.
4. Los IDs locales/históricos se conservan para trazabilidad y migración; el objetivo es una identidad canónica y un único torneo activo, no multi-tenancy.
5. Ninguna retirada puede destruir actas, enlaces publicados, logs, snapshots, mappings o datos locales recuperables.
6. La documentación de esta matriz no acredita por sí sola que una capacidad esté implementada ni validada.

## 2. Matriz de trazabilidad

| Requisito/capacidad de PR #79 | Tratamiento en la aplicación única | Fase objetivo | Evidencia de salida requerida |
|---|---|---|---|
| Identidad y vínculo Gestor–Tabulación | Sustituir el vínculo entre productos por contexto único del torneo y referencias canónicas; conservar mappings históricos mientras haya consumidores | Fase 1; retirada en Fase 2 | Contratos runtime versionados, resolución explícita por ID, pruebas de ida/vuelta y ausencia de matching heurístico |
| Equipos, instituciones, oradores y jueces | Gestión/Participantes es propietario de la identidad y relaciones; Tabulación conserva atributos reglamentarios especializados | Fase 1–2 | Snapshot común validado, adaptadores tipados y pruebas de actualización sin pérdida de campos |
| Salas físicas, rondas y asignaciones | Propiedad común del núcleo operativo; los sorteos de Tabulación siguen siendo borradores hasta publicación explícita | Fase 1–3 | Publicación validada en servidor, revisión, idempotencia y rechazo de relaciones inválidas |
| Reglas de tabulación persistidas | Un único editor en Configuración; Tabulación conserva el motor y los tipos especializados | Fase 1–3 | Persistencia versionada, validación backend, snapshot de reglas por acta/ronda y conflicto optimista |
| Clasificación y Top 5 + «Ver más» | El motor de Tabulación es el único cálculo reglamentario; Gestión consume su proyección | Fase 3 | Contrato de lectura común y pruebas de igualdad entre vista de Tabulación y vista de Gestión |
| Actas por juez y actas conjuntas | Mantener ambas semánticas; el módulo de actas es propietario del contenido y de la versión oficial | Fase 3–5 | Conversión sin pérdida, validación, preview/diff, confirmación de sustitución, historial append-only y auditoría |
| Actas de eliminatorias | Mantener el modo de papeleta definido por las reglas; no inferir que toda eliminatoria implica papeleta individual | Fase 3–5 | Pruebas específicas de modalidad, progresión y compatibilidad con actas conjuntas |
| Puntuaciones, rúbricas, oradores y sanciones | Conservar los campos que influyen en ganador, desempates y auditoría; no aceptar resultados calculados solo por el cliente | Fase 3–5 | DTO validado, contexto autoritativo completo y pruebas de regresión reglamentaria |
| Historial de sustituciones y contador de reescrituras | Conservar como historial inmutable del módulo de actas, no como una sincronización entre productos | Fase 3–5 | Versiones enlazadas, contador derivado del historial y rollback transaccional probado |
| Outbox offline, leases, reintentos y recuperación | Un mecanismo de persistencia local de la aplicación; no dos colas para sincronizar dos aplicaciones | Fase 4 | Persistencia atómica o recuperación demostrada, lease multi-pestaña, mismo operationId en reintentos y ACK verificable |
| Conflictos y revisiones | Conflictos explícitos por entidad/revisión; prohibido last-write-wins silencioso | Fase 4 | Pruebas de concurrencia, 409, timeout ambiguo, relectura y resolución explícita |
| Short links de ocho caracteres | Mantener resolución backend, aleatoriedad criptográfica, unicidad, colisiones, rate limits, caducidad/revocación y auditoría | Fase 3–5 | Pruebas de colisión/concurrencia, límites, revocación, idempotencia, no enumerabilidad y fallback autocontenido |
| Compatibilidad A1/A2 y enlaces autocontenidos | Mantener lectores antiguos y fallback autónomo; no romper enlaces ya compartidos | Fase 3–5 | Fixtures históricos, round-trip, enlaces cortos y largos, fallback cuando API no esté disponible |
| Salud/conectividad | Mantener indicador como señal de disponibilidad, sin confundir health 200 con ACK de una escritura | Fase 2–4 | Pruebas de estados offline/online y confirmación de escritura independiente del health check |
| Seguridad de publicación y permisos | Un backend y una autoridad de autorización; validar sesión, actor, torneo y relaciones en servidor | Fase 2–5 | Tests de autorización negativa, sesión caducada y operaciones no autorizadas |
| Observabilidad y auditoría | Infraestructura compartida, correlación por operationId y actor, sin registrar secretos | Fase 3–5 | Logs trazables y pruebas de no exposición de credenciales |
| Soporte multi-torneo del store local | No es requisito de producto; simplificar solo después de inventariar datos, backups, import/export y consumidores | Fase 0–2 | Migración compatible a un torneo activo, exportación/backup verificable y pruebas de recuperación |

## 3. Orden de ejecución y dependencias

### Paso A — Baseline y trazabilidad (Fase 0)
- Mantener el inventario de código, endpoints, tablas, migraciones, stores, enlaces y pruebas de PR #79.
- Clasificar cada pieza como conservar, adaptar o retirar.
- No borrar ni reescribir migraciones ya aplicadas.
- No simplificar todavía el índice multi-torneo de Tabulación: primero se debe demostrar cómo se preservan los datos existentes.

### Paso B — Contratos comunes (Fase 1)
- Identidad canónica tipada y mappings explícitos.
- Contrato único de sesión y, a continuación, contexto del torneo activo.
- Contratos versionados para participantes, reglas, salas, rondas y asignaciones.
- Adaptadores de ida/vuelta con pruebas de caracterización; sin casts masivos ni matching por nombre.

### Paso C — Experiencia integrada (Fase 2)
- Bootstrap y navegación compartidos.
- Acceso a Gestión y Tabulación bajo una misma sesión y contexto.
- Retirar el vínculo/login independiente solo cuando ambos módulos consuman el bootstrap común.
- Conservar pantallas y modelos especializados.

### Paso D — Casos de uso y modularización (Fase 3)
- Reglas, publicación de rondas, clasificación y actas mediante servicios comunes.
- Short links y compatibilidad de formatos integrados en el mismo backend.
- Separar handlers, reglas de dominio y adaptadores sin cambiar semántica funcional.

### Paso E — Persistencia y resiliencia (Fase 4)
- Unificar outbox/worker sin perder operaciones ya almacenadas.
- Asegurar atomicidad local, ACK verificable, idempotencia, leases y conflictos explícitos.
- Mantener el cronómetro operativo aunque la sincronización general esté caída.

### Paso F — Cierre funcional y validación (Fase 5)
- Pruebas de PostgreSQL/Neon Preview aislado, concurrencia, rollback, timeout post-commit y dos dispositivos.
- Verificar actas individuales, conjuntas y eliminatorias, historial, short links y compatibilidad histórica.
- No probar contra Production ni aplicar migraciones allí sin autorización expresa.

## 4. Estado de implementación conocido al crear esta matriz

- **PR #84:** identidad canónica tipada integrada inicialmente en `panelBridge.buildOutbox`; contrato común de sesión adoptado por Gestión y Tabulación. La CI del HEAD `4595bd2149671185dc76e27d05103968b90a5338` terminó correctamente.
- **Implementado en el incremento actual:** contrato tipado de contexto del torneo activo; validación runtime del handoff heredado de participantes (estructura, IDs, revisiones, duplicados y relaciones equipo-orador/juez-incompatibilidad), con rechazo seguro de snapshots inválidos.
- **Implementado en PR #84:** contrato versionado de snapshot común de participantes con adaptadores tipados desde Gestión y Tabulación, mappings explícitos en el adaptador de Tabulación, validación runtime de IDs/referencias/duplicados y tests de round-trip. Los campos específicos de cada módulo permanecen en sus modelos.
- **Implementado en PR #84:** bootstrap runtime versionado que compone y revalida sesión, contexto activo y snapshot de participantes; Gestión y Tabulación lo utilizan para habilitar sus workers. Tabulación solo proyecta participantes cuando existe un mapping explícito. Tests cubren expiración, torneo cruzado y ausencia de contexto.
- **Pendiente en PR #84:** convertir el bootstrap derivado en memoria en proveedor runtime común y único; retirar gradualmente el handoff temporal solo tras migración/rollback probados; propagar identidad a casos de uso comunes. No se ha unificado todavía la navegación, el ciclo de vida ni la persistencia de ambos shells.
- **No se declara completada la aplicación única:** todavía existen shells, stores y modelos especializados separados.
- **No se declara completada la validación de PR #79:** las pruebas reales con PostgreSQL/Neon aislado, Redis Preview independiente, concurrencia multi-dispositivo y validación completa de short links siguen sujetas a sus evidencias específicas.
- **No se ha autorizado ni ejecutado en este incremento:** merge, deployment, migraciones o escrituras en Neon.

## 5. Criterio para cerrar el pivote

El pivote no estará terminado hasta que todos los requisitos funcionales que sigan vigentes en PR #79 tengan una implementación integrada y pruebas asociadas, y se hayan retirado de forma segura los puentes que solo existían para conectar dos aplicaciones. Esta matriz deberá actualizarse con enlaces a commits, tests y ejecuciones de CI; cambiar una casilla a «completado» sin evidencia no es aceptable.
