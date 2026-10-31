# Consolidación de funciones serverless de Vercel

## Estado y objetivo

Esta modificación reorganiza la distribución del backend de la PR #79 para cumplir el límite del plan Hobby de Vercel (12 funciones serverless por deployment). El deployment del commit anterior falló con `exceeded_serverless_functions_per_deployment`: Vercel estaba detectando demasiados archivos dentro de `api/`.

El objetivo es que exista una sola función desplegable: `api/index.ts`. La consolidación no reduce ni sustituye funcionalidades; separa el punto de entrada HTTP del código de dominio y de las pruebas.

## Nueva estructura

- `api/index.ts`: único entrypoint serverless. Conserva el adaptador HTTP, parsing de solicitudes, ruta de health y despacho de acciones.
- `server/`: módulos de backend compartidos, trasladados desde `api/`.
- `tests/api/`: pruebas unitarias del backend, fuera del directorio de funciones.
- `src/`: permanece sin cambios; los módulos backend siguen usando los mismos tipos y reglas de dominio.

## Inventario de movimientos

### Implementación trasladada de `api/` a `server/`

- `core.ts`
- `db.ts`
- `postgres-store.ts`
- `sync-operation-policy.ts`
- `sync-operation-validation.ts`
- `tabulation-acta-domain.ts`
- `tabulation-acta-history.ts`
- `tabulation-acta-identity.ts`
- `tabulation-acta-source.ts`
- `tabulation-acta-write.ts`
- `tabulation-elimination.ts`
- `tabulation-round-publish.ts`
- `tabulation-settings-validation.ts`
- `tabulation-sync-domain.ts`

### Pruebas trasladadas de `api/` a `tests/api/`

Se trasladan las pruebas `*.test.ts` de los módulos anteriores, incluida la prueba de `core`. Se actualizan sus imports relativos para que sigan probando los mismos módulos.

## Compatibilidad que debe mantenerse

El entrypoint conserva el contrato existente:

- `GET /api?action=health` mantiene la respuesta de salud.
- Las solicitudes `POST` siguen recibiendo el objeto JSON `{ action, payload }`.
- Se conserva el despacho de todas las acciones: `login`, `logout`, `getTournament`, `getTabulationSettings`, `saveTabulationSettings`, `getTabulationActaHistory`, `getTabulationActaVersion`, `previewTabulationActa`, `saveTabulationActa`, `publishTabulationRound`, `getPublicRoom`, `roomHeartbeat`, `getRoomConnectionStatuses`, `getRoomControllerToken`, `saveTournament`, `saveScoreConfig`, `getRoundActivationPreview`, `activateRound` y `updateRoomTimer`.
- No se cambian esquemas de payload, códigos HTTP, respuestas, autenticación, límites, idempotencia, control de revisiones, transacciones ni escrituras de auditoría.
- No se cambia la conexión con Neon, Redis ni las variables de entorno.
- `vercel.json` conserva sus ajustes; no se añaden rewrites ni se cambia el fallback SPA.

## Imports y compilación

Los imports del entrypoint apuntan a `../server/*.js`. Al estar `server/` al mismo nivel que `api/`, los imports internos a `../src/` y los imports relativos entre módulos de backend mantienen su profundidad.

El script `typecheck:api` apunta a los módulos bajo `server/`. `tsconfig.app.json` incluye ahora `server/` y `tests/` para que el proyecto compuesto de TypeScript no rechace los imports del backend y las pruebas movidas. Las pruebas bajo `tests/api/` actualizan imports a `../../server/` y `../../src/`; dos pruebas del frontend que dependían de helpers antiguos de `api/` también apuntan a `server/`.

## Riesgos y validación

1. **Descubrimiento de funciones:** confirmar en Preview que Vercel detecta una única función bajo `api/` y no reproduce el límite de 12.
2. **Enrutamiento:** probar `GET /api?action=health` y solicitudes POST válidas/no válidas; ninguna ruta API debe terminar en `/index.html`.
3. **Regresión de acciones:** ejecutar suite completa y `typecheck:api`; el dispatcher debe conservar todas las acciones enumeradas.
4. **Build frontend:** ejecutar build de producción para detectar errores de imports.
5. **Persistencia:** validar en Neon Preview lectura, guardado de actas, historial, publicación de ronda, idempotencia y rollback. No ejecutar migraciones ni pruebas destructivas contra Neon Production.

## Criterio de aceptación

La consolidación está técnicamente lista cuando CI pasa, Vercel Preview termina sin el límite de funciones, las rutas de salud/API mantienen sus contratos y las pruebas de dominio/persistencia pasan. La validación funcional con Neon Preview sigue siendo independiente y no debe darse por completada solo porque la build termine.

## Reversión

Revertir el commit de consolidación completo. No requiere cambios de esquema ni migraciones, porque solo reorganiza archivos e imports.
