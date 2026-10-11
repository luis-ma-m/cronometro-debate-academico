# Definición funcional — LEDU Control

## Objetivo
Crear una aplicación web para organizar un torneo académico LEDU. Se compone de gestión privada y cronómetros públicos por sala. Se reescribe el proyecto desde cero; el repositorio previo solo se considera referencia conceptual.

## Alcance de la primera versión
1. Formato de competición: LEDU; fases y tiempos editables para adecuarse a las bases oficiales del torneo.
2. Panel con rondas, equipos, jueces, salas, enfrentamientos, estado y múltiples jueces por sala.
3. Acceso privado al panel. El placeholder de contraseña es válido exclusivamente en modo demostración; producción utiliza ADMIN_PASSWORD en propiedades de Apps Script.
4. Google Sheets como almacenamiento mediante Google Apps Script.
5. Cada cronómetro se controla desde su propia pantalla de sala; el panel de gestión es de consulta y asignación.
6. Cronómetros accesibles mediante enlaces públicos del tipo /sala/:id.
7. Sincronización automática de datos cada 8 segundos, sin recarga de página.

## Arquitectura
- Interfaz: React, TypeScript y Vite.
- Backend: funciones web de Google Apps Script.
- Persistencia: una hoja Google Sheets con seis pestañas.
- Reloj: estado persistido en Sheets con startedAt / lastResumedAt y segundos restantes; el navegador calcula la visualización localmente.
- Control de concurrencia: LockService para escrituras, contador de revisión para prevenir sobrescrituras silenciosas y revisión por sala para acciones de reloj.

## Modelo de datos
- Config: clave, valor; nombre del torneo y revisión global.
- Rondas: ID, número, nombre, activa.
- Equipos: ID, nombre, institución, activo.
- Jueces: ID, nombre, institución, activo.
- Salas: ID, nombre, ronda, equipo a favor, equipo en contra, lista de jueces, estado, fases, notas y fecha de actualización.
- Cronometros: ID de sala, estado, fase, segundos restantes, marca de inicio, última reanudación, revisión y fecha de actualización.

Los vínculos se realizan mediante IDs, no por nombres. Un equipo y un juez no pueden aparecer en dos salas de la misma ronda. Se permite asignar más de un juez a una sala.

## Reglas del cronómetro
- Cada sala mantiene su propio timer.
- Acciones disponibles en sala: iniciar/reanudar, pausar, reiniciar debate y siguiente fase.
- El reloj se basa en marcas temporales, no en el número de ejecuciones de setInterval.
- El estado visible se refresca con frecuencia local y el estado del torneo se consulta a los ocho segundos.
- Al avanzar desde la última fase, el timer queda finalizado.
- El preset no pretende sustituir el reglamento; los tiempos deben comprobarse y ajustarse por edición.

## Seguridad y operación
- Las contraseñas y tokens no deben almacenarse en parámetros de URL.
- El backend valida sesión en operaciones de administración.
- La hoja no debe compartirse públicamente con permisos de edición.
- Las URL de cronómetro muestran información del debate y no deben contener secretos.
- El despliegue de Apps Script debe verificarse con un navegador real para permisos y CORS antes del torneo.

## Criterios de aceptación
- Una sala pública muestra nombres de equipos, jueces, fase, estado y tiempo.
- Iniciar o pausar una sala no afecta al resto.
- Los cambios de asignación se ven en la página de sala sin recargar manualmente.
- El panel distingue salas preparadas, en curso, pausadas, finalizadas y pendientes.
- El backend impide equipos y jueces duplicados en la misma ronda.
- La gestión exige sesión válida cuando el backend está configurado.
- El proyecto compila y los tests de cronómetro pasan en CI.
