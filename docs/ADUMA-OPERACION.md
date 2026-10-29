# V Torneo Nacional ADUMA — Guía de operación de la tabulación

Guía para la mesa de tabulación: qué hacer antes del torneo, en cada ronda y ante cada incidencia. Cómo se aplica el reglamento está en [ADUMA-INTERPRETACIONES.md](ADUMA-INTERPRETACIONES.md); el funcionamiento técnico, en [TABULACION.md](TABULACION.md).

## Material

- **Ordenador principal** con Chrome actualizado. No uses ventanas de incógnito ni borres los datos del navegador: la tabulación se guarda en él.
- **Ordenador de reserva** con Chrome, que ya haya abierto la misma dirección.
- **Dos sitios para las copias:** una memoria USB y una carpeta en la nube, por ejemplo.
- Impresora, o un ordenador desde el que imprimir los PDF.
- **La misma dirección los dos días:** `https://<dominio del panel>/tabulacion`. Los datos van ligados a la dirección exacta y al navegador.
- **El WhatsApp de la mesa** en el ordenador principal (WhatsApp Web o la aplicación de escritorio), para recibir las actas de los jueces.

## Calendario

| Fecha | Qué |
|---|---|
| Hasta el viernes 13 de noviembre | **Ensayo general** en el ordenador y el navegador del torneo. En Inicio, «Crear ensayo ADUMA con equipos de ejemplo»; recorre las 4 rondas, cuartos, semifinales y final con «Simular resultados»; abre en Windows un ZIP y su PDF; marca un equipo como caído; prueba el traspaso al ordenador de reserva (ver «Incidencias»). Al terminar, borra el ensayo en Inicio. |
| Antes del torneo | El comité valida [ADUMA-INTERPRETACIONES.md](ADUMA-INTERPRETACIONES.md). Cualquier cambio de criterio se hace en Reglas antes de la primera ronda. |
| Martes 17 de noviembre | **Congelación:** no se publica ninguna versión nueva. Anota la versión que aparece al pie de la tabulación (por ejemplo `v1.0.0 · 57b54aa · …`) y comprueba que es la misma los dos días. |
| Viernes 20 y sábado 21 | Torneo. |

## Preparación de los datos (días antes)

1. **Crear el torneo.** En Inicio, pulsa «Crear Torneo ADUMA» y escribe el nombre del operador; se anota en cada entrada del registro.
2. **Equipos.** En Participantes → Equipos, pega la lista (`Equipo;Institución;Integrante 1;Integrante 2;…`). El contador debe marcar 20/20.
3. **Jueces.** Pega la lista (`Juez;Institución;Nivel;Preside;Móvil`) y revisa el nivel y quién puede presidir.
4. **Incompatibilidades.** En la pestaña Incompatibilidades, pega `Juez;Equipo o institución;objetiva|subjetiva;nota` y corrige los nombres que no se reconozcan. Compartir institución con un equipo ya cuenta como objetiva sin anotarlo.
5. **Instituciones.** Revisa la tabla: cada institución debe estar escrita igual en equipos y jueces. Si aparece un aviso de nombres parecidos, unifícalos.
6. **Salas.** Añade las 10 salas.
7. **WhatsApp.**
   - En Participantes → Jueces, escribe el móvil de cada juez que pueda presidir; también puede ir como quinta columna al pegar la lista.
   - En Reglas → «Actas por WhatsApp», escribe el móvil de la mesa.
   - Si usas la tabulación en local y no en la web publicada, escribe ahí la dirección pública.
   - Crea un grupo de WhatsApp con los jueces y prueba el circuito en el ensayo general.
8. **Diagnóstico.** En Inicio, pulsa «Comprobar ahora» hasta que diga «Todo en orden».
9. **Copia.** Pulsa «Exportar copia» y guárdala en los dos sitios.

## Cada ronda

1. **Disponibilidad.** En Participantes → Jueces, deja marcados como «Disponible» solo a los presentes.
2. **Nueva ronda.** En Rondas, para la Ronda 1 escribe la semilla del sorteo público (un número o una palabra, que cualquiera podrá reproducir). Pulsa «Nueva ronda».
3. **Revisión del borrador.** Lee los avisos: revanchas, incompatibilidades, paneles de dos, equipos sin debate…
   - Cambia a mano lo que haga falta. Si eliges un equipo, sala o juez que ya estaba en otro debate, se intercambian.
   - «Deshacer» revierte el último cambio y «Reasignar todos los jueces» repite la asignación automática.
   - Todo queda en el registro.
4. **Confirmar ronda** (barra fija al pie del borrador). Si hay avisos, marca «Confirmo bajo mi responsabilidad». Se descarga el ZIP:
   - cópialo en los dos sitios;
   - publica o imprime `publico/<ronda>.pdf`; las salas van en orden natural y no revelan la clasificación;
   - la ronda aparece en pantalla; pulsa «Proyectar» (Esc para salir).
5. **Enlaces de las actas.** En la ronda, abre «Actas por WhatsApp».
   - Pulsa «Enviar enlace» en cada sala: se abre WhatsApp con el mensaje para su juez principal.
   - O pulsa «Copiar todos los enlaces para el grupo de jueces» y pégalo en el grupo.
6. **Actas por WhatsApp.**
   - Cada juez principal rellena el acta en el móvil con el jurado y pulsa «Enviar por WhatsApp».
   - En Actas → «Actas recibidas por WhatsApp», copia los mensajes que vayan llegando (puedes pegar el chat entero) y pulsa «Aceptar» en cada una, o «Aceptar las … nuevas sin incidencias».
   - Revisa las que muestren avisos y cruza el total con el papel cuando llegue.
7. **Actas en papel** de las salas que no la hayan enviado. Transcríbelas en el orden del papel: postura, ítems (Enter baja por la columna), faltas, total escrito, ganador, jurado, notas de los integrantes con sus posiciones y notas. «Guardar y siguiente» o Ctrl+Enter.
   - Si hay prisa, usa el **modo rápido** (ganador y totales) y completa el detalle después.
   - Un aviso «total escrito no coincide» suele ser un error de transcripción: revísalo.
8. **Al terminar las actas**, pasa el Diagnóstico y exporta una copia.

Las rondas son a ciegas: no proyectes la Clasificación hasta acabar la cuarta ronda (en modo proyección se oculta sola).

## Situaciones especiales

- **Equipo caído.** En Participantes, marca «Equipo caído» y elige «desde la ronda»; por defecto es la primera ronda en la que su debate no tiene acta.
  - Sus debates no se disputan, no llevan sala ni jueces, y su rival gana con la media de ítems de la ronda.
  - Si ya había un borrador, saldrá el aviso «Han cambiado datos»: pulsa «Volver a sortear».
- **Número impar de equipos.** Participantes muestra el botón «Añadir equipo «Descanso»».
- **Un juez no llega y la ronda ya está confirmada.** En la tabla de la ronda, elige a otro juez en el desplegable del ausente, o pulsa «Completar jueces».
- **Acta equivocada.** Corrígela en Actas; el cambio queda registrado.
- **Ronda confirmada por error y sin actas.** En la ronda, «Más acciones» → «Reabrir como borrador»: vuelve a ser un borrador y al confirmarla se descarga un ZIP nuevo.
- **Empate en el corte para cuartos.** En Clasificación, «Fijar este orden» (o «Sortear») según decida el comité.
- **Eliminatorias.**
  1. «Generar eliminatorias» saca los cuartos 1–8, 3–6, 2–7, 4–5; cada uno se confirma como una ronda.
  2. Después, «Nueva eliminatoria» para semifinales (ganador 1–8 contra ganador 3–6, y ganador 2–7 contra ganador 4–5) y para la final.
  3. En las actas de eliminatoria solo se anota ganador, postura y notas.
- **Auditoría.** «Más acciones» → «Auditar el sorteo» en una ronda confirmada comprueba que su semilla reproduce el emparejamiento. También lista los cambios manuales, que están en el registro con hora y operador.

## Incidencias

| Qué pasa | Qué hacer |
|---|---|
| Se cierra el navegador o se cuelga | Vuelve a abrir la misma dirección: todo está guardado, borradores incluidos. |
| «Otra pestaña… está editando» | Cierra la otra pestaña o pulsa «Tomar el control». Solo una pestaña puede escribir. |
| «Conflicto con otra pestaña» | Normalmente, «Cargar la otra versión». Si dudas, exporta antes una copia. |
| Una pantalla muestra «Esta pantalla ha fallado» | Pulsa «Copia de emergencia» y luego «Reintentar», abre otra pantalla o recarga. Los datos guardados no se pierden. |
| «No queda espacio» | Exporta una copia y borra en Inicio los torneos de ensayo. La tabulación ya libera sola la copia automática más antigua (y lo anota). |
| El ordenador principal deja de funcionar | En el de reserva, abre la misma dirección → Inicio → «Importar copia». Elige `privado/copia-torneo.json` del último ZIP, o la última copia exportada. El registro viene con la copia. Vuelve a pasar las actas posteriores a esa copia. |
| Falla el PDF | El ZIP incluye `error-pdf.txt`: imprime el TXT o el CSV. |
| «La verificación ha encontrado problemas» en el registro | Exporta el registro (CSV y JSON) tal como está, avisa al comité y sigue: el registro empieza un tramo nuevo. |
| Se cae internet | La página abierta sigue funcionando: no la recargues. Las copias se guardan en local. Las actas por WhatsApp esperan a que vuelva la red: mientras, usa el papel. |
| Un juez no puede abrir el enlace o no tiene datos | Usa el acta en papel. El enlace solo funciona si la web está publicada (no en `localhost`). |
| «El código está dañado o incompleto» | Pide al juez que pulse otra vez «Enviar por WhatsApp»: su acta sigue guardada en el móvil. |
| «Este código no es de ningún debate» | La ronda se volvió a sortear después de enviar los enlaces: envía los enlaces nuevos. |
| Llegan dos actas del mismo debate | La bandeja marca la más reciente; acepta esa. Si la mesa ya había transcrito el papel, pedirá confirmación antes de sustituirla. |

## Al cerrar cada día

- [ ] El ZIP de cada ronda está en los dos sitios.
- [ ] Hay una copia exportada después de las últimas actas.
- [ ] El Diagnóstico dice «Todo en orden».
- [ ] El registro está verificado y exportado (Registro → «Verificar registro», CSV y JSON).
