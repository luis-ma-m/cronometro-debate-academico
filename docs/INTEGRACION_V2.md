# Integración v2: Tabulación como núcleo del gestor

## Estado

**Propuesta técnica y criterios de aceptación. Implementación funcional pendiente.**

Esta rama se ha creado sobre `feat/sync-recovery-operation-status`, que contiene la línea actual de contratos compartidos y recuperación de sincronización. Esta PR no debe considerarse lista para merge hasta completar los criterios de aceptación y las pruebas descritas aquí.

## Objetivo de producto

Eliminar la separación funcional entre Gestión y Tabulación. El usuario debe operar un único gestor, con una única navegación y un único contexto de torneo activo. Tabulación será el motor de dominio para participantes, rondas, asignaciones, actas, resultados y clasificación. Neon será la persistencia remota autoritativa y la fuente compartida entre sesiones/dispositivos.

Los cronómetros existentes deben seguir funcionando con sus URLs públicas y su API de control; no se deben duplicar ni reemplazar con temporizadores nuevos.

## Alcance funcional

### 1. Navegación y shell único

- Eliminar las secciones actuales del gestor excepto **Resumen** y **Rondas y salas**.
- Incorporar en el gestor las secciones operativas equivalentes de Tabulación: participantes, emparejamientos/rondas, actas, clasificación, registro/auditoría y configuración de tabulación.
- Mantener un solo shell, sesión autenticada, torneo activo, sistema de notificaciones y estado de conexión.
- `/tabulacion` deja de ser una aplicación/sección independiente. Durante la transición, redirigir de forma compatible a la sección equivalente dentro del gestor y conservar deep links soportados.
- Eliminar la duplicidad de navegación, bootstrap, ciclo de vida React y selección de torneo. No mantener dos aplicaciones React embebidas como solución final.

### 2. Tabulación como único motor de dominio

Todas las operaciones de:
- creación, edición, desactivación y vinculación de equipos, oradores, jueces e instituciones;
- incompatibilidades y disponibilidad;
- generación, edición, publicación y asignación de rondas;
- asignación de salas, equipos y jueces;
- actas individuales y conjuntas, penalizaciones y puntuaciones;
- resultados, eliminatorias, desempates, clasificaciones y premios;

deben pasar por los tipos, validadores, reglas y cálculos del dominio `src/tabulation`.

No mantener algoritmos paralelos en Gestión. El gestor puede exponer formularios y vistas, pero debe invocar casos de uso de Tabulación. Crear adaptadores explícitos para el dominio persistido y no usar conversiones estructurales/casts entre `Tournament` y `TabTournament`.

### 3. Neon como persistencia remota autoritativa

- Todas las operaciones de dominio deben persistirse y recuperarse a través de la API de servidor y Neon; el navegador nunca se conecta directamente a Neon.
- No debe quedar una fuente paralela operativa en localStorage/IndexedDB que pueda discrepar silenciosamente del servidor. Se puede conservar caché/offline y outbox local, pero con revisiones, ACKs e idempotencia verificables.
- Definir repositorio/servicio de aplicación canónico que atienda ambos módulos durante la migración y finalmente sustituya stores paralelos.
- Todo comando de escritura lleva `operationId`, `tournamentId`, `baseRevision`, hash del payload y tipo/identidad de entidad. ACK transaccional persistido, reintentos idempotentes y resolución explícita de conflictos; prohibido last-write-wins global.
- Cada actualización de entidades relacionadas, asignaciones y auditoría debe ser atómica en Neon.
- Las vistas de clasificación/resultados se calculan desde rondas y actas persistidas con las reglas versionadas aplicables; no tratar resultados derivados como copias editables independientes.
- Migraciones SQL nuevas, aditivas y versionadas. No reescribir migraciones ya aplicadas ni borrar mappings o datos históricos. Mantener compatibilidad de lectura/rollback hasta validar la migración.

### 4. Integración exacta con cronómetros

- Mantener como autoridad del ciclo de vida del cronómetro las tablas/acciones existentes de timer, sus revisiones CAS, eventos y control de sala.
- La publicación de una ronda desde Tabulación debe crear/actualizar asignaciones oficiales compatibles con las que consume el sistema de cronómetros.
- Cada asignación debe enlazar mediante IDs canónicos una ronda, debate, sala física, equipos y juez(es), conservando el ID de asignación consumido por las rutas de cronómetro.
- Al iniciar, pausar, reanudar, reiniciar, avanzar, retroceder o finalizar un cronómetro, usar el API actual y su compare-and-swap; no duplicar estado de timer dentro de Tabulación.
- Un cambio de asignación o ronda debe tener una política explícita para cronómetros activos: bloquear el cambio o exigir transición confirmada, nunca dejar un timer apuntando a una asignación eliminada o sustituida.
- Los cronómetros públicos deben seguir funcionando aunque la interfaz de gestión cambie de ruta o se recargue. Mantener short links/URLs públicas existentes.
- Pruebas end-to-end: publicar ronda → verificar asignación en Neon → abrir URL de sala → controlar timer desde cliente autorizado → observar estado/eventos desde otro cliente → recargar y recuperar el estado correcto.

## Principios de migración

1. Un único torneo activo en el flujo normal de la aplicación.
2. Identidades canónicas opacas y mappings explícitos. Nunca unir registros por nombre, orden o similitud.
3. Preservar rondas, papeletas, actas conjuntas, historial, logs, enlaces cortos y auditoría.
4. Mantener offline-first como resiliencia de cliente, no como autoridad concurrente. Una operación local pendiente no debe anunciarse como confirmada en Neon.
5. No activar corte irreversible ni eliminar rutas legacy hasta disponer de pruebas de migración, recuperación y rollback.
6. No ejecutar migraciones o escrituras de prueba en Neon Production.

## Plan de implementación obligatorio

### Fase A — Núcleo de aplicación y navegación
- Componer un único shell y proveedor de sesión/contexto de torneo.
- Mover rutas/vistas de Tabulación al router del gestor.
- Eliminar las secciones obsoletas sin borrar lógica de dominio útil.
- Mantener Resumen y Rondas y salas, conectados al mismo estado y repositorio.

### Fase B — Casos de uso unificados
- Introducir comandos/queries de aplicación para participantes, incompatibilidades, rondas, asignaciones, actas y clasificación.
- Migrar todos los controles de Gestión para usar los casos de uso de Tabulación.
- Retirar cálculos y validaciones duplicadas solo tras equivalencia de resultados probada.
- Centralizar reglas de tabulación en Configuración del gestor.

### Fase C — Persistencia Neon completa
- Completar repositorio/servicios y esquema de dominio relacional.
- Migrar lecturas de todas las vistas a queries del repositorio canónico.
- Migrar escrituras a comandos tipados, transacciones, revisiones CAS, idempotencia y auditoría.
- Añadir outbox y recuperación offline/multi-cliente con conflictos explícitos.
- Verificar que ningún flujo normal persiste únicamente en los stores locales especializados.

### Fase D — Contrato de cronómetros
- Formalizar y validar el puente entre asignación de Tabulación y asignación del gestor usada por timers.
- Garantizar integridad referencial y coherencia de rondas/salas/debates.
- Añadir tests de integración y E2E de ciclo de vida de timers con dos clientes.
- Mantener compatibilidad con los endpoints, claves de control y enlaces ya emitidos.

### Fase E — Corte y retirada segura
- Activar el nuevo recorrido en el shell único.
- Redirigir `/tabulacion` y preservar enlaces profundos soportados.
- Eliminar lectores/escritores duplicados y rutas legacy solo después de verificar que no quedan consumidores.
- Añadir métricas/logs de sincronización, conflictos, ACK ambiguos y recuperación.
- Documentar procedimientos operativos y rollback.

## Criterios de aceptación (bloquean el merge)

- [ ] Solo existen las secciones de navegación Resumen, Rondas y salas y las secciones de Tabulación integradas.
- [ ] No existe un segundo shell ni un segundo bootstrap de aplicación/torneo.
- [ ] No quedan formularios del gestor que escriban directamente entidades/rondas/actas mediante lógica paralela.
- [ ] Participantes, rondas, asignaciones, actas y rankings pasan por casos de uso del dominio Tabulación.
- [ ] Las operaciones confirmadas sobreviven a recarga, nueva sesión y segundo dispositivo y aparecen desde Neon.
- [ ] La outbox recupera operaciones ante timeout/desconexión sin duplicar commits.
- [ ] Conflictos de revisión no pisan cambios concurrentes; se conservan ambas versiones para resolución.
- [ ] La clasificación y resultados mostrados coinciden con los cálculos de Tabulación sobre el snapshot confirmado.
- [ ] Publicar una ronda produce asignaciones válidas consumibles por el cronómetro existente.
- [ ] Los timers mantienen CAS, auditoría, control de una sola sesión de escritura por sala, URLs y comportamiento offline ya existente.
- [ ] Pruebas de contrato, unitarias, integración con Neon aislado, multi-cliente y E2E pasan.
- [ ] Migraciones probadas en una base aislada y rollback/documentación verificados.
- [ ] Sin escrituras de prueba en Neon Production.

## Suite mínima de pruebas

- Tests de dominio para pairing, standings, resultados, actas, penalizaciones, incompatibilidades y desempates.
- Tests de API para autorización, validación DTO, revisión obsoleta, transacción e idempotencia.
- Tests de persistencia Neon con dos conexiones y conflicto de revisiones.
- Tests multi-pestaña/recarga para repositorio y outbox IndexedDB.
- E2E de extremo a extremo desde gestión de participantes hasta timer en sala y acta final.
- Tests de compatibilidad de enlaces públicos/short links y redirect `/tabulacion`.

## Dependencias y orden de integración actual

Esta rama nace sobre `feat/sync-recovery-operation-status`, que contiene las PR de integración en curso. La línea base incluye PR #79, #84, #85 y #86 aún abiertas en el momento de creación de esta rama. No asumir que están mergeadas en `main`.

Orden de consolidación que debe validarse antes de mergear:
1. Cerrar/revisar los criterios de PR #79 (integración funcional original).
2. Integrar #84 (contratos y persistencia local común).
3. Integrar #85 (concurrencia del snapshot de Gestión).
4. Integrar #86 (recuperación de ACK ambiguos).
5. Rebasar esta PR sobre el resultado consolidado y resolver duplicidades antes de merge.

No fusionar esta PR con la pila incompleta ni desplegar a Production hasta superar los criterios de aceptación.

## Estado de implementación en esta entrega

Esta primera entrega añade esta especificación de arquitectura, fases y aceptación. No cambia todavía la aplicación, el esquema SQL, los endpoints ni las rutas de cronómetros. La existencia de esta PR no significa que la integración funcional esté terminada.
