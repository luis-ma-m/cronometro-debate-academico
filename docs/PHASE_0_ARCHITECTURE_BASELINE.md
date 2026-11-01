# Fase 0 — Baseline e inventario de arquitectura

- **Fecha del baseline:** 2026-10-31
- **Decisión arquitectónica de referencia:** [ARCHITECTURE_DECISION_SINGLE_APPLICATION.md](./ARCHITECTURE_DECISION_SINGLE_APPLICATION.md)
- **Rama funcional inspeccionada:** `feat/tabulation-manager-sync`
- **Commit funcional inspeccionado:** `1f338be5b63b38b8f36a6bceb154b257252daa64`
- **Base comparada:** `main` en `808ee7b566883397876c26244fa090a7bb0ccef1`
- **Estado:** baseline inicial documentado; Fase 0 todavía no se considera cerrada.

---

## 1. Objetivo y alcance

Este documento registra el estado observable del repositorio antes de iniciar la transición hacia una única aplicación modular con dos vertientes: **Gestión** y **Tabulación**.

El baseline no autoriza cambios destructivos ni declara que la implementación actual sea production-ready. Sirve para:
- identificar las piezas que ya existen;
- separar arquitectura actual, arquitectura objetivo y compatibilidades temporales;
- localizar contradicciones entre código, documentación y decisión aprobada;
- fijar los recorridos que no pueden romperse;
- establecer qué pruebas faltan antes de refactorizar o retirar componentes.

La inspección se ha centrado en el diff de la PR #79 respecto a `main`, los puntos de entrada, la composición de React, la API, los modelos de Tabulación, almacenamiento local, sincronización, migraciones y documentación de validación. No equivale todavía a una revisión línea por línea de todos los archivos del repositorio.

## 2. Fotografía del repositorio

En el momento de la inspección:

| Elemento | Estado observado |
|---|---|
| PR #79 | Rama `feat/tabulation-manager-sync` abierta como línea de implementación de la integración |
| Diferencia frente a `main` | 485 commits por delante, 0 por detrás |
| Diff comparado | 102 archivos; aproximadamente 10.320 adiciones y 154 eliminaciones |
| Frontend | React 18, TypeScript, Vite |
| Backend | Una función API principal en `api/index.ts`, con lógica de dominio extraída parcialmente a `server/` |
| Persistencia oficial | PostgreSQL/Neon mediante adaptadores del servidor |
| Coordinación/servicios auxiliares | Redis/Upstash para sesión y coordinación operativa descrita en la documentación |
| Tabulación local | Store de navegador propio, con revisiones, backups y registro de cambios |
| Cola de sincronización | IndexedDB mediante outbox, worker, dispatcher y ACK |
| Despliegue | Vercel, con `api/index.ts` como función configurada |
| Migraciones de la PR | `0010` a `0021` añadidas en la rama |

**Advertencia sobre el tamaño del diff:** 485 commits no equivalen a 485 funcionalidades ni permiten medir el porcentaje de integración. El número de archivos y líneas tampoco demuestra completitud. El baseline funcional debe basarse en recorridos y contratos verificados.

## 3. Mapa de entradas y composición de la aplicación

### 3.1 Entrada frontend

`src/main.tsx` selecciona la aplicación según la ruta:
- rutas generales: `App` (Gestión);
- `/tabulacion`: `TabulationApp`;
- `/acta`: `JudgeActaApp`.

Los tres entry points se renderizan dentro del mismo bundle/arranque React, pero la selección de ruta monta aplicaciones raíz distintas. Esto es una **separación de shells y ciclos de estado**, aunque compartan repositorio y despliegue.

**Implicación:** el estado actual no cumple todavía el objetivo de una experiencia unificada. No se debe concluir que basta con cambiar el menú: hay que unificar sesión, identidad, contratos y autoridad de datos, manteniendo las pantallas especializadas que sigan siendo útiles.

### 3.2 Gestión

`src/App.tsx` concentra una cantidad elevada de responsabilidades:
- estado del torneo y navegación;
- sesión, login y logout;
- llamadas API y recarga del torneo;
- salas, rondas y asignaciones;
- cronómetros y estado de conexión;
- puntuaciones y configuración;
- publicación de rondas de Tabulación;
- carga de historial de actas;
- cola de sincronización y coordinación de ACK.

El archivo importa directamente infraestructura de sincronización (`panelBridge`, `syncOutbox`, `syncOutboxWorker`, `syncDispatcher`) y también reglas de dominio de cronómetro, incompatibilidades y puntuación.

**Clasificación inicial:** adaptar y modularizar. No moverlo todo de golpe. Primero extraer casos de uso y contratos detrás de pruebas de caracterización; después reducir el componente a composición de presentación.

### 3.3 Tabulación

`src/tabulation/TabulationApp.tsx` contiene su propio shell, navegación, sesión del Gestor leída desde `localStorage`, estado de conexión y arranque del worker de sincronización. Se apoya en vistas especializadas (`HomeView`, `RulesView`, `RoundsView`, `BallotsView`, `StandingsView`, entre otras).

El modelo de Tabulación (`TabTournament`, `TabSettings`, `TabTeam`, `TabJudge`, `TabBallot`, `TabJointActa`, etc.) expresa conceptos reglamentarios que no deben convertirse automáticamente en el modelo operativo `Tournament` del Gestor.

**Clasificación inicial:** conservar los modelos especializados; adaptar el shell y los servicios para que usen la identidad y los casos de uso de la aplicación única.

### 3.4 Actas de jueces

`JudgeActaApp` se monta bajo una ruta específica y no debe tratarse como una tercera aplicación de negocio. Es una superficie de captura para un rol/flujo concreto. Debe quedar integrada en el mismo producto, con autorización acotada, enlaces compatibles y sin exponer la sesión de administración.

## 4. Mapa inicial de dominios y contratos

| Dominio | Modelo/ubicación observada | Estado inicial | Dirección |
|---|---|---|---|
| Torneo operativo | `src/domain.ts`, `src/App.tsx` | Modelo del Gestor y estado centralizado | Mantener como núcleo operativo, extraer casos de uso |
| Participantes | `Team`, `Speaker`, `Judge` en dominio compartido y tipos Tabulación | Representaciones paralelas | Identidad compartida; DTOs y adaptadores tipados |
| Salas y cronómetro | `src/domain.ts`, `src/timer.ts`, API y `server/core.ts` | Recorrido operativo existente | Preservar autonomía local del timer |
| Rondas y asignaciones | Gestor + tipos y operaciones de Tabulación | Borrador/publicación y mapping de IDs | Un caso de uso oficial de publicación |
| Reglas | `TabSettings`, presets, `TabulationRulesPanel` y `RulesView` | Persistencia y consumo no completamente coherentes | Una única edición y una revisión efectiva compartida |
| Actas | Modelos de Tabulación, scoring del Gestor, módulos `server/tabulation-acta-*` | Fuentes inmutables y proyección a scoring | Preservar historial y semántica de cada tipo |
| Clasificación | `src/tabulation/results.ts`, vistas de clasificación | Motor especializado y proyecciones | Un único cálculo autoritativo |
| Sincronización | `panelBridge`, `reconciliation`, `panelSync`, outbox, worker, dispatcher | Bridge entre shells | Convertir en persistencia/recuperación interna y retirar handoff |
| Short links | `actaShortLink.ts`, API, migración 0020 y 0021 | Implementación online más formatos autocontenidos | Conservar compatibilidad y seguridad |

La matriz es una primera clasificación por dominio, no una afirmación de que todas las dependencias internas hayan sido trazadas.

## 5. Persistencia y autoridad observadas

### 5.1 Backend y PostgreSQL

La documentación de migración y el código del servidor identifican PostgreSQL/Neon como persistencia oficial de la API del Gestor. `server/postgres-store.ts` adapta las estructuras relacionales a los modelos operativos heredados. `api/index.ts` continúa actuando como dispatcher principal.

La API conserva contratos históricos con nombres como `loadSheetData` y `SheetData` como formas de compatibilidad, aunque la documentación indica que las lecturas y escrituras operativas ya usan PostgreSQL. Estos nombres deben evaluarse para simplificación posterior; no se renombrarán de forma masiva en Fase 0.

### 5.2 Estado local de Tabulación

`src/tabulation/store.ts` utiliza una abstracción de almacenamiento Web Storage, mantiene un índice de torneos locales, snapshots, backups, revisiones, control de escritor entre pestañas y log de cambios. El código expone operaciones para crear, abrir, importar, eliminar y enumerar torneos locales.

Esto requiere una decisión de transición importante:
- el producto objetivo admite **un único torneo activo**;
- la existencia de múltiples entradas históricas/locales en el store no debe confundirse con soporte de múltiples torneos simultáneos;
- debe determinarse si se conserva un archivo/exportación recuperable o si se simplifica el índice a una única instalación activa;
- no se borrará información local ni se ejecutará una migración destructiva hasta definir recuperación y compatibilidad.

### 5.3 Outbox y sincronización local

La rama incorpora repositorio IndexedDB, outbox, worker, dispatcher, hashes, identificadores de operación, leases y ACK. Es una base reutilizable para resiliencia, pero hoy está acoplada al vínculo entre Tabulación y Gestor.

La nueva arquitectura debe preservar las garantías útiles y retirar la semántica de “dos productos que se sincronizan”. Sigue pendiente demostrar en entorno real:
- atomicidad entre cambio local y registro de operación pendiente;
- recuperación tras cierre abrupto;
- timeout posterior a commit y repetición con el mismo `operationId`;
- exclusión y recuperación de leases entre pestañas/dispositivos;
- conflictos explícitos sin last-write-wins.

## 6. Migraciones y persistencia especializada

La rama incorpora migraciones `0010`–`0021`. Entre las piezas inspeccionadas:
- `0010`: persistencia de configuración de Tabulación;
- `0011`: identidad del torneo;
- `0012`: fuentes e historial de actas;
- `0020`: enlaces cortos de actas;
- `0021`: límites de tasa de short links.

La migración `0012` implementa una estructura de fuentes append-only, relación de sustitución, puntero a versión vigente, idempotencia y restricciones para proteger la integridad. Es una decisión valiosa que debe conservarse.

La migración `0020` almacena identificadores de ocho caracteres, snapshots, hash, clave idempotente, caducidad/revocación y eventos. También debe conservarse, sujeta a revisión de autorización, privacidad, retención y pruebas.

**Regla obligatoria:** no editar migraciones que puedan haberse aplicado. Toda simplificación se hará con nuevas migraciones append-only, compatibles y con pruebas de upgrade desde esquemas soportados.

## 7. Discrepancias y bloqueos ya identificados

Los siguientes problemas están documentados en el último commit funcional inspeccionado y son relevantes para la arquitectura objetivo:

1. **Reglas oficiales no consumidas por el motor local:** el panel del Gestor lee/escribe la configuración persistida, pero `HomeView`/`TabulationApp` no consumen `getTabulationSettings`; el cálculo local puede seguir usando `tournament.settings` y divergir de la validación server-side.
2. **Aplicación de reglas incompleta:** falta el flujo aprobado para aplicar cambios desde ahora o retroactivamente, con confirmación, auditoría y snapshot efectivo por ronda.
3. **Edición duplicada de reglas:** `RulesView` continúa editable desde Tabulación aunque exista vínculo con el Gestor.
4. **Validación de formato con rondas:** el panel construye un torneo auxiliar sin rondas para reutilizar `RulesView`; el guard de `hasRounds` no observa necesariamente las rondas reales.
5. **Shells independientes:** rutas separadas montan aplicaciones raíz distintas y Tabulación vuelve a leer la sesión del Gestor desde almacenamiento del navegador.
6. **Identidad local múltiple:** el store mantiene índice de torneos locales, lo que debe reconciliarse con la decisión de un único torneo activo.
7. **Concentración de responsabilidades:** `App.tsx` y `api/index.ts` siguen actuando como puntos de coordinación amplios.

Los cuatro primeros puntos están registrados en el commit `1f338be5b63b38b8f36a6bceb154b257252daa64` y bloquean considerar cerrada la sincronización de reglas. No deben “arreglarse” ocultando controles: requieren contrato, versionado, propagación de revisión y pruebas de coherencia de cálculo.

## 8. Rutas críticas que deben protegerse

| Recorrido | Invariantes que no pueden romperse | Evidencia mínima exigida |
|---|---|---|
| Inicio de sesión y sesión de operador | Autorización correcta; superficies de jueces no heredan privilegios de administrador | Tests de sesión válida, inválida y caducada |
| Cronómetro de sala | Timer sigue funcionando sin API/Redis/red; un único controlador por sala; revisión CAS | Unitarios + E2E offline + dos clientes |
| Participantes | IDs estables; relaciones equipo-orador; incompatibilidades validadas | Tests de dominio y persistencia |
| Preparar/publicar ronda | Borrador no muta estado oficial; asignaciones completas y válidas; publicación idempotente | Tests de preview, publicación, retry y rollback |
| Guardar acta individual | Conserva papeletas, votos, rúbrica, notas y oradores; fuente histórica inmutable | Tests de dominio + PostgreSQL real |
| Guardar acta conjunta | Conserva ganador declarado, ítems, rúbrica, sanciones y snapshot de reglas | Tests de dominio + PostgreSQL real |
| Acta de eliminatoria | Conserva ganador/perdedor/avance sin forzar semántica clasificatoria | Tests específicos |
| Sustituir acta | Diff y confirmación explícita; compare-and-swap; historial lineal; contador exacto | Dos escrituras concurrentes + timeout post-commit |
| Clasificación | Reglas, desempates y proyecciones consistentes entre vistas | Tests de propiedades/regresión y fixtures |
| Short links | Ocho caracteres, idempotencia, expiración, revocación, rate limit y fallback autocontenido | Tests API + compatibilidad de formatos |
| Offline/outbox | Operación local durable, ACK verificable, recuperación sin duplicados | Playwright multi-pestaña y pruebas contra Preview |

## 9. Matriz inicial de reutilización

| Componente | Clasificación | Acción futura |
|---|---|---|
| Modelos especializados de Tabulación | **Conservar** | Mantener conceptos reglamentarios; definir IDs y contratos canónicos |
| Dominio de cronómetro y control de sala | **Conservar** | Aislar de la sincronización y reforzar pruebas offline |
| Historial append-only de actas y snapshot de reglas | **Conservar** | Preservar constraints, CAS, idempotencia y auditoría |
| Publicación explícita de rondas | **Conservar** | Integrar en un único caso de uso |
| Short links y formatos autocontenidos | **Conservar** | Mantener compatibilidad y validar seguridad |
| Outbox, leases, retry y ACK | **Adaptar** | Convertir en mecanismo interno de persistencia y recuperación |
| `panelBridge.ts` | **Adaptar temporalmente** | Compatibilidad mientras se retira el handoff |
| `reconciliation.ts` y `panelSync.ts` | **Adaptar** | Extraer políticas de conflicto; eliminar reconciliación entre productos |
| Mapeos local/remoto de identidad | **Adaptar** | Mantener solo compatibilidad histórica y migración |
| `src/App.tsx` | **Adaptar** | Extraer casos de uso, estado de dominio y presentación |
| `api/index.ts` | **Adaptar** | Mantener dispatcher desplegable único; delegar en módulos |
| Shells independientes de Gestor/Tabulación | **Sustituir progresivamente** | Unificar composición, sesión, navegación y contexto |
| Vinculación manual entre dos torneos/productos | **Retirar** | Eliminar una vez migrados y validados los flujos necesarios |
| Soporte de múltiples torneos activos | **Retirar** | No introducir nueva complejidad multi-torneo |
| Datos históricos locales | **Conservar hasta migración/exportación segura** | No confundir limpieza de arquitectura con borrado de información |

## 10. Estado de pruebas y evidencia

### 10.1 Lo que sí existe

- Scripts para build, tests unitarios, cobertura, E2E y typecheck API.
- Pruebas de dominio/API para actas, publicación, validación, short links y sincronización.
- Pruebas de outbox y worker.
- E2E de resiliencia y UX.
- Tests de migraciones y de integración Neon.
- Checklist de validación final que distingue pruebas automatizadas de validación real en Preview/Neon.

### 10.2 Lo que no debe darse por probado

El checklist de la PR #79 deja explícitamente pendientes pruebas que requieren Preview/Neon y navegador real, entre ellas:
- aplicación ordenada de migraciones en una base de pruebas limpia y desde esquemas previos;
- transacciones/constraints contra PostgreSQL real;
- vínculo y propagación entre dispositivos;
- conflictos concurrentes;
- recuperación tras timeout posterior al commit;
- sustituciones concurrentes de actas y rollback real;
- flujos completos de actas individuales, conjuntas y eliminatorias;
- recorridos E2E contra Preview real;
- observabilidad y validación de configuración Preview.

Un test unitario con cliente PostgreSQL simulado no demuestra por sí solo el comportamiento transaccional real de Neon. Un bloqueo de Vercel por cuota tampoco equivale a un build fallido.

### 10.3 Baseline CI

El estado de checks debe consultarse de nuevo sobre el commit que vaya a modificarse o desplegarse. No se reutilizará el resultado de un commit anterior como evidencia del HEAD actual. No se ha ejecutado ningún deployment como parte de este baseline.

## 11. Decisiones y tareas de Fase 0

| ID | Tarea | Estado |
|---|---|---|
| F0-01 | Registrar decisión de aplicación única y single-tournament | **Hecho** — documento de decisión |
| F0-02 | Inventariar entradas frontend, API y shells | **Parcial** — mapa inicial en este documento |
| F0-03 | Inventariar modelos y propietarios de dominio | **Parcial** — matriz inicial |
| F0-04 | Inventariar persistencia, migraciones y almacenamiento local | **Parcial** — piezas principales identificadas |
| F0-05 | Trazar dependencias entre Gestor, Tabulación y sincronización | **Parcial** — faltan imports y dependencias transitivas de todo el repositorio |
| F0-06 | Clasificar componentes conservar/adaptar/sustituir/retirar | **Parcial** — matriz inicial |
| F0-07 | Definir baseline reproducible de build, typecheck, unitarios y E2E | **Pendiente** — requiere ejecutar comandos sobre un checkout verificable |
| F0-08 | Completar matriz de recorridos críticos y cobertura | **Parcial** — recorridos identificados; falta cobertura por test |
| F0-09 | Confirmar esquema soportado y estado de migraciones en Preview aislado | **Pendiente** — no ejecutar sobre Production |
| F0-10 | Revisar todos los usos del concepto multi-torneo y su impacto histórico | **Pendiente** |
| F0-11 | Completar grafo de dependencias frontend/backend y ciclo de vida de datos | **Pendiente** |
| F0-12 | Acordar secuencia y criterios de las fases 1–7 a partir de evidencias | **Pendiente** |

## 12. Próxima secuencia de trabajo

1. Completar inventario de archivos, imports y dependencias de todos los módulos, no solo del diff de PR #79.
2. Ejecutar baseline reproducible de build, typecheck, tests unitarios y E2E en un entorno local limpio, registrando commit, comandos y resultados.
3. Revisar los usos de `tournamentId`, `panelLink`, índices locales, rutas y contratos de vinculación para separar identidad estable de soporte multi-torneo.
4. Crear matriz de propiedad de datos y dependencias entre módulos, incluyendo qué código lee/escribe cada tabla y clave de almacenamiento.
5. Trazar cada recorrido crítico desde UI hasta API, servicio, transacción, almacenamiento y proyección.
6. Convertir los bloqueos conocidos de reglas en requisitos de Fase 1/5, sin mezclarlos con una refactorización cosmética.
7. Cerrar Fase 0 con un inventario completo y evidencia reproducible antes de iniciar cambios estructurales de gran alcance.

## 13. Restricciones de ejecución

- No cambiar ni borrar migraciones históricas.
- No ejecutar migraciones, seeds, escrituras de prueba ni pruebas destructivas en Neon Production.
- No crear deployments solo para obtener una señal de build si existe una alternativa local/CI; respetar la cuota de Vercel.
- No retirar código de compatibilidad hasta demostrar que no hay rutas activas ni datos que dependan de él.
- No borrar el store local ni sus backups como parte de una simplificación multi-torneo.
- No declarar Fase 0 terminada hasta completar los puntos pendientes y adjuntar resultados reproducibles.

**Conclusión del baseline:** la rama contiene piezas valiosas para la aplicación objetivo —especialmente persistencia de actas, publicación explícita, idempotencia, short links y outbox—, pero la experiencia y varios contratos siguen organizados alrededor de dos shells con estado e identidad parcialmente separados. La prioridad no es reescribirlos, sino fijar propiedad de datos y contratos, cerrar las discrepancias funcionales ya conocidas y extraer límites modulares con pruebas.
