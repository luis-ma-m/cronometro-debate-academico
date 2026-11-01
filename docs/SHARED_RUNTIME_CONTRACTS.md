# Contratos compartidos de runtime

## Objetivo

El pivote hacia una sola aplicación requiere eliminar contratos duplicados entre Gestión y Tabulación antes de unificar sus shells. Este documento registra el primer contrato transversal de runtime adoptado por ambos módulos.

## Sesión de Gestión

Implementación: `src/contracts/managerSession.ts`.

- La clave persistida `ledu-admin-session` tiene un único propietario contractual.
- Gestión y Tabulación leen y validan la sesión mediante `readManagerSession`.
- La validación se hace en runtime: token no vacío, longitud máxima de 200 caracteres y caducidad entera estrictamente futura.
- Escritura y borrado pasan por `writeManagerSession` y `clearManagerSession`.
- JSON corrupto, sesiones caducadas y formas inesperadas se tratan como sesión no disponible.
- Los tests cubren parseo, expiración, round-trip, corrupción y borrado.

## Alcance y límites

Este cambio elimina la duplicación del formato de sesión y de su clave entre los dos shells. **No** unifica todavía la autenticación, el ciclo de vida de React, las rutas ni el estado de Gestión y Tabulación. La sesión continúa almacenada localmente para compatibilidad; el servidor sigue siendo la autoridad de autorización y caducidad.

No se debe interpretar la presencia de una sesión local como prueba de autorización. Cada endpoint protegido debe seguir verificando el token en servidor.

## Siguiente paso arquitectónico

1. Inventariar los demás contratos compartidos de runtime (selección de torneo, identidad activa, conexión y estado de sincronización).
2. Establecer un bootstrap común que resuelva el contexto activo una sola vez.
3. Migrar rutas y shells a ese bootstrap sin cambiar todavía la propiedad de datos de cada módulo.
4. Retirar el acceso directo duplicado a almacenamiento solo después de migrar y probar todos los consumidores.

La aplicación mantiene un único torneo activo por instalación. El ID estable del torneo sigue siendo necesario para integridad, auditoría e idempotencia; no implica soporte multi-torneo.
