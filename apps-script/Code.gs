/**
 * LEDU Control — Google Apps Script backend.
 *
 * The spreadsheet ID below is the sheet supplied for this project. A
 * SPREADSHEET_ID Script Property can override it for other deployments.
 * Set ADMIN_PASSWORD in Script Properties before deploying the web app.
 * Never use the demo password as a production credential.
 */
const DEFAULT_SPREADSHEET_ID = '1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI';
const SHEETS = {
  Config: ['key', 'value'],
  Rondas: ['id', 'number', 'name', 'active'],
  Equipos: ['id', 'name', 'institution', 'active'],
  Jueces: ['id', 'name', 'institution', 'active'],
  Salas: ['id', 'name', 'roundId', 'teamFavorId', 'teamContraId', 'judgeIds', 'status', 'phases', 'notes', 'updatedAt'],
  Cronometros: ['roomId', 'status', 'phaseIndex', 'remainingSeconds', 'startedAt', 'lastResumedAt', 'revision', 'updatedAt'],
  Registro: ['event_id', 'timestamp_utc', 'room_round_id', 'round_id', 'room_id', 'phase_index', 'event_type', 'elapsed_seconds', 'details']
};
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function doGet(e) {
  const action = String(e && e.parameter && e.parameter.action || '');
  if (action === 'health') {
    try {
      const spreadsheet = spreadsheet_();
      return json_({ ok: true, data: { status: 'ok', service: 'LEDU Control API', spreadsheet: spreadsheet.getName(), now: Date.now() } });
    } catch (error) {
      return json_({ ok: false, error: { code: error.code || 'BACKEND_NOT_READY', message: String(error.message || error) } });
    }
  }
  return json_({
    ok: true,
    data: {
      service: 'LEDU Control API',
      status: 'ready-to-test',
      healthUrl: '?action=health',
      message: 'Este es el backend de la aplicación. Publica el frontend React por separado y configura VITE_APPS_SCRIPT_URL con la URL /exec.'
    }
  });
}

function doPost(e) {
  try {
    const body = JSON.parse(e && e.postData && e.postData.contents || '{}');
    const payload = body.payload || {};
    const data = dispatch_(String(body.action || ''), payload);
    return json_({ ok: true, data: data });
  } catch (error) {
    return json_({ ok: false, error: { code: error.code || 'SERVER_ERROR', message: String(error.message || error) } });
  }
}

function dispatch_(action, p) {
  switch (action) {
    case 'login': return login_(p);
    case 'getTournament': requireSession_(p.token); return readTournament_();
    case 'getPublicRoom': return getPublicRoom_(String(p.roomId || ''));
    case 'getRoomControllerToken': return getRoomControllerToken_(p);
    case 'saveTournament': requireSession_(p.token); return saveTournament_(p);
    case 'updateRoomTimer': return updateRoomTimer_(p);
    default: throw apiError_('UNKNOWN_ACTION', 'Acción no reconocida.');
  }
}

function login_(p) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected) throw apiError_('NOT_CONFIGURED', 'Configura ADMIN_PASSWORD en las propiedades del script.');
  if (!p.password || !constantTimeEquals_(String(p.password), expected)) throw apiError_('UNAUTHORIZED', 'Contraseña incorrecta.');
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, '1', SESSION_TTL_SECONDS);
  return { token: token, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
}

function requireSession_(token) {
  if (!token || CacheService.getScriptCache().get('session:' + String(token)) !== '1') {
    throw apiError_('UNAUTHORIZED', 'Sesión caducada o no válida. Vuelve a iniciar sesión.');
  }
}

function readTournament_() {
  const config = readObjects_('Config');
  const rounds = readObjects_('Rondas').map(function (r) {
    return { id: str_(r.id), number: num_(r.number), name: str_(r.name), active: bool_(r.active) };
  });
  const teams = readObjects_('Equipos').map(function (t) {
    return { id: str_(t.id), name: str_(t.name), institution: str_(t.institution), active: bool_(t.active) };
  });
  const judges = readObjects_('Jueces').map(function (j) {
    return { id: str_(j.id), name: str_(j.name), institution: str_(j.institution), active: bool_(j.active) };
  });
  const timers = {};
  readObjects_('Cronometros').forEach(function (t) { timers[str_(t.roomId)] = timerFromRow_(t); });
  const rooms = readObjects_('Salas').map(function (r) {
    const phases = parseJson_(r.phases, []);
    const timer = timers[str_(r.id)] || initialTimer_(phases);
    return {
      id: str_(r.id), name: str_(r.name), roundId: str_(r.roundId),
      teamFavorId: str_(r.teamFavorId), teamContraId: str_(r.teamContraId),
      judgeIds: parseJson_(r.judgeIds, []), status: str_(r.status) || 'unassigned',
      phases: phases, timer: timer, notes: str_(r.notes), updatedAt: num_(r.updatedAt)
    };
  });
  return {
    tournamentName: str_(configValue_(config, 'tournamentName')) || 'Torneo LEDU',
    rounds: rounds, teams: teams, judges: judges, rooms: rooms,
    formatPhases: parseJson_(configValue_(config, 'formatPhases'), defaultPhases_()),
    revision: num_(configValue_(config, 'revision')) || 1,
    updatedAt: num_(configValue_(config, 'updatedAt')) || Date.now()
  };
}

function getPublicRoom_(roomId) {
  if (!roomId) throw apiError_('INVALID_ROOM', 'Falta el identificador de sala.');
  const tournament = readTournament_();
  const room = tournament.rooms.find(function (r) { return r.id.toLowerCase() === roomId.toLowerCase(); });
  if (!room) throw apiError_('ROOM_NOT_FOUND', 'No se encuentra esa sala.');
  const round = tournament.rounds.find(function (r) { return r.id === room.roundId; });
  const favor = tournament.teams.find(function (t) { return t.id === room.teamFavorId; });
  const contra = tournament.teams.find(function (t) { return t.id === room.teamContraId; });
  const judges = room.judgeIds.map(function (id) {
    const judge = tournament.judges.find(function (j) { return j.id === id; });
    return judge ? judge.name : '';
  }).filter(Boolean);
  return { tournamentName: tournament.tournamentName, roundName: round ? round.name : '',
    room: publicRoomData_(room), teamFavor: favor ? favor.name : '', teamContra: contra ? contra.name : '',
    judges: judges, serverTime: Date.now() };
}

function publicRoomData_(room) {
  return { id: room.id, name: room.name, roundId: room.roundId, teamFavorId: room.teamFavorId,
    teamContraId: room.teamContraId, judgeIds: room.judgeIds, status: room.status,
    phases: room.phases, timer: room.timer, updatedAt: room.updatedAt };
}

function getRoomControllerToken_(p) {
  requireSession_(p.token);
  const roomId = str_(p.roomId);
  if (!roomId) throw apiError_('INVALID_ROOM', 'Falta el identificador de sala.');
  const row = readObjects_('Salas').find(function (item) { return str_(item.id).toLowerCase() === roomId.toLowerCase(); });
  if (!row) throw apiError_('ROOM_NOT_FOUND', 'Guarda primero los cambios de esa sala.');
  const key = roomControlPropertyKey_(str_(row.id));
  const properties = PropertiesService.getScriptProperties();
  let token = properties.getProperty(key);
  if (!token || p.rotate === true || String(p.rotate).toLowerCase() === 'true') {
    token = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty(key, token);
  }
  return { token: token };
}

function roomControlPropertyKey_(roomId) {
  return 'ROOM_CONTROL_TOKEN_' + String(roomId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function saveTournament_(p) {
  const input = p.tournament;
  if (!input || !Array.isArray(input.rooms) || !Array.isArray(input.teams) ||
      !Array.isArray(input.judges) || !Array.isArray(input.rounds)) {
    throw apiError_('INVALID_PAYLOAD', 'Estructura del torneo inválida.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const configRows = readObjects_('Config');
    const currentRevision = num_(configValue_(configRows, 'revision')) || 1;
    if (num_(p.expectedRevision) !== currentRevision) {
      throw apiError_('REVISION_CONFLICT', 'El torneo cambió en otro dispositivo. Actualiza los datos antes de guardar.');
    }
    validateAssignments_(input);
    const formatPhases = Array.isArray(input.formatPhases) && input.formatPhases.length ? input.formatPhases : (input.rooms[0] && input.rooms[0].phases || defaultPhases_());
    validatePhases_(formatPhases);
    const previousFormat = parseJson_(configValue_(configRows, 'formatPhases'), defaultPhases_());
    const formatChanged = JSON.stringify(previousFormat) !== JSON.stringify(formatPhases);
    const previousRoomRows = readObjects_('Salas');
    const roomPhasesChanged = input.rooms.some(function (room) {
      const oldRoom = previousRoomRows.find(function (row) { return str_(row.id) === str_(room.id); });
      return oldRoom && JSON.stringify(parseJson_(oldRoom.phases, [])) !== JSON.stringify(room.phases || []);
    });
    const resetTimers = formatChanged || roomPhasesChanged;
    const persistedTimerRows = readObjects_('Cronometros');
    if (resetTimers && persistedTimerRows.some(function (row) { return row.status === 'running' || row.status === 'paused'; })) {
      throw apiError_('ACTIVE_TIMERS', 'No se puede cambiar el formato mientras haya cronómetros en curso o pausados. Detén los debates y vuelve a guardar.');
    }
    writeObjects_('Rondas', input.rounds.map(function (r) { return { id: r.id, number: r.number, name: r.name, active: r.active }; }));
    writeObjects_('Equipos', input.teams.map(function (t) { return { id: t.id, name: t.name, institution: t.institution, active: t.active }; }));
    writeObjects_('Jueces', input.judges.map(function (j) { return { id: j.id, name: j.name, institution: j.institution, active: j.active }; }));
    writeObjects_('Salas', input.rooms.map(function (r) {
      return { id: r.id, name: r.name, roundId: r.roundId, teamFavorId: r.teamFavorId || '',
        teamContraId: r.teamContraId || '', judgeIds: JSON.stringify(r.judgeIds || []),
        status: deriveRoomStatus_(r), phases: JSON.stringify(r.phases || []), notes: r.notes || '', updatedAt: Date.now() };
    }));
    // Keep stored live timers for existing rooms; the management browser may
    // hold an older timer snapshot from its last poll.
    const storedTimers = {};
    persistedTimerRows.forEach(function (timerRow) {
      storedTimers[str_(timerRow.roomId)] = timerFromRow_(timerRow);
    });
    writeObjects_('Cronometros', input.rooms.map(function (r) {
      const previous = storedTimers[str_(r.id)];
      let t = previous || initialTimer_(r.phases || formatPhases);
      if (resetTimers) {
        t = initialTimer_(r.phases || formatPhases);
        t.revision = previous ? previous.revision + 1 : 0;
      }
      if (r.phases && t.phaseIndex >= r.phases.length) {
        t = initialTimer_(r.phases);
        t.revision = previous ? previous.revision + 1 : t.revision;
      }
      return { roomId: r.id, status: t.status, phaseIndex: t.phaseIndex, remainingSeconds: t.remainingSeconds,
        startedAt: t.startedAt || '', lastResumedAt: t.lastResumedAt || '', revision: t.revision || 0, updatedAt: t.updatedAt || Date.now() };
    }));
    const nextRevision = currentRevision + 1;
    setConfig_('tournamentName', input.tournamentName || 'Torneo LEDU');
    setConfig_('formatPhases', JSON.stringify(formatPhases));
    setConfig_('revision', String(nextRevision));
    setConfig_('updatedAt', String(Date.now()));
    SpreadsheetApp.flush();
    return readTournament_();
  } finally { lock.releaseLock(); }
}

function updateRoomTimer_(p) {
  const roomId = String(p.roomId || '');
  const action = String(p.action || '');
  if (['start', 'pause', 'reset', 'next', 'previous', 'finish'].indexOf(action) < 0) throw apiError_('INVALID_ACTION', 'Acción de cronómetro no válida.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const row = readObjects_('Salas').find(function (r) { return String(r.id).toLowerCase() === roomId.toLowerCase(); });
    if (!row) throw apiError_('ROOM_NOT_FOUND', 'No se encuentra esa sala.');
    const canonicalId = String(row.id);
    const expectedKey = PropertiesService.getScriptProperties().getProperty(roomControlPropertyKey_(canonicalId));
    if (!expectedKey || !p.controlKey || !constantTimeEquals_(String(p.controlKey), expectedKey)) throw apiError_('UNAUTHORIZED', 'Abre esta sala desde el panel de organización para controlar el cronómetro.');
    const phases = parseJson_(row.phases, []);
    if (action === 'start' && (!str_(row.teamFavorId) || !str_(row.teamContraId) || str_(row.teamFavorId) === str_(row.teamContraId) || !parseJson_(row.judgeIds, []).length)) throw apiError_('INVALID_ASSIGNMENT', 'Asigna dos equipos distintos y al menos un juez antes de iniciar.');
    if (action === 'start') validatePhases_(phases);
    const stored = readObjects_('Cronometros').find(function (t) { return String(t.roomId) === canonicalId; });
    const timer = stored ? timerFromRow_(stored) : initialTimer_(phases);
    if (p.expectedRevision === undefined || num_(p.expectedRevision) !== timer.revision) throw apiError_('REVISION_CONFLICT', 'El cronómetro cambió en otro dispositivo. Actualiza el estado.');
    const oldIndex = timer.phaseIndex;
    const oldStatus = timer.status;
    const oldRemaining = remaining_(timer, Date.now());
    const timestamp = Date.now();
    const next = transitionTimer_(timer, phases, action, timestamp);
    if (next.revision === timer.revision) return publicRoomFromTournament_(canonicalId, readTournament_());
    upsertById_('Cronometros', 'roomId', canonicalId, { roomId: canonicalId, status: next.status, phaseIndex: next.phaseIndex, remainingSeconds: next.remainingSeconds, startedAt: next.startedAt || '', lastResumedAt: next.lastResumedAt || '', revision: next.revision, updatedAt: next.updatedAt });
    upsertById_('Salas', 'id', canonicalId, Object.assign({}, row, { status: deriveRoomStatus_(Object.assign({}, row, { timer: next })), updatedAt: timestamp }));
    appendTimerEvent_(row, next, action, oldIndex, oldStatus, oldRemaining, timestamp);
    SpreadsheetApp.flush();
    return publicRoomFromTournament_(canonicalId, readTournament_());
  } finally { lock.releaseLock(); }
}

function appendTimerEvent_(roomRow, next, action, phaseIndex, previousStatus, remainingBefore, timestamp) {
  const phases = parseJson_(roomRow.phases, []);
  const phase = phases[phaseIndex] || {};
  const types = { start: previousStatus === 'paused' ? 'resumed' : 'started', pause: 'paused', reset: 'reset', next: next.status === 'finished' ? 'finished' : 'phase_advanced', previous: 'phase_rewound', finish: 'finished' };
  const elapsed = Math.max(0, num_(phase.durationSeconds) - remainingBefore);
  sheet_('Registro').appendRow([Utilities.getUuid(), new Date(timestamp).toISOString(), str_(roomRow.id), str_(roomRow.roundId), str_(roomRow.id), phaseIndex, types[action] || action, Math.round(elapsed), JSON.stringify({ action: action, fromStatus: previousStatus, toStatus: next.status, revision: next.revision })]);
}

function publicRoomFromTournament_(roomId, tournament) {
  const room = tournament.rooms.find(function (r) { return r.id === roomId; });
  if (!room) throw apiError_('ROOM_NOT_FOUND', 'No se encuentra esa sala.');
  const round = tournament.rounds.find(function (r) { return r.id === room.roundId; });
  const favor = tournament.teams.find(function (t) { return t.id === room.teamFavorId; });
  const contra = tournament.teams.find(function (t) { return t.id === room.teamContraId; });
  const judges = room.judgeIds.map(function (id) { const item = tournament.judges.find(function (j) { return j.id === id; }); return item ? item.name : ''; }).filter(Boolean);
  return { tournamentName: tournament.tournamentName, roundName: round ? round.name : '', room: publicRoomData_(room), teamFavor: favor ? favor.name : '', teamContra: contra ? contra.name : '', judges: judges, serverTime: Date.now() };
}

function validateAssignments_(t) {
  const rounds = new Set((t.rounds || []).map(function (item) { return str_(item.id); }));
  const teamIds = new Set((t.teams || []).map(function (item) { return str_(item.id); }));
  const judgeIds = new Set((t.judges || []).map(function (item) { return str_(item.id); }));
  const teamBookings = {};
  const judgeBookings = {};
  (t.rooms || []).forEach(function (room) {
    if (!rounds.has(str_(room.roundId))) throw apiError_('INVALID_ASSIGNMENT', 'La sala ' + str_(room.name) + ' tiene una ronda inexistente.');
    if (room.teamFavorId && room.teamFavorId === room.teamContraId) throw apiError_('INVALID_ASSIGNMENT', 'Un equipo no puede debatir contra sí mismo.');
    [room.teamFavorId, room.teamContraId].filter(Boolean).forEach(function (id) {
      if (!teamIds.has(str_(id))) throw apiError_('INVALID_ASSIGNMENT', 'Una sala contiene un equipo inexistente.');
      const key = room.roundId + ':' + id;
      if (teamBookings[key]) throw apiError_('TEAM_DOUBLE_BOOKED', 'Un equipo está asignado a dos salas de la misma ronda.');
      teamBookings[key] = true;
    });
    const localJudges = {};
    (room.judgeIds || []).forEach(function (id) {
      if (!judgeIds.has(str_(id))) throw apiError_('INVALID_ASSIGNMENT', 'Una sala contiene un juez inexistente.');
      if (localJudges[id]) throw apiError_('INVALID_ASSIGNMENT', 'Un juez aparece más de una vez en la misma sala.');
      localJudges[id] = true;
      const key = room.roundId + ':' + id;
      if (judgeBookings[key]) throw apiError_('JUDGE_DOUBLE_BOOKED', 'Un juez está asignado a dos salas de la misma ronda.');
      judgeBookings[key] = true;
    });
    validatePhases_(room.phases);
  });
}

function validatePhases_(phases) {
  if (!Array.isArray(phases) || phases.length === 0) throw apiError_('INVALID_PHASES', 'El formato debe incluir al menos una intervención.');
  const seen = {};
  phases.forEach(function (phase, index) {
    if (!phase || !str_(phase.id) || !str_(phase.name).trim() || !str_(phase.speaker).trim()) {
      throw apiError_('INVALID_PHASES', 'La intervención ' + (index + 1) + ' necesita identificador, nombre e interviniente.');
    }
    if (seen[str_(phase.id)]) throw apiError_('INVALID_PHASES', 'Hay identificadores de intervención duplicados.');
    seen[str_(phase.id)] = true;
    if (phase.side !== 'favor' && phase.side !== 'contra') throw apiError_('INVALID_PHASES', 'Cada intervención debe asociarse a A favor o En contra.');
    const duration = Number(phase.durationSeconds);
    if (!Number.isFinite(duration) || duration < 1 || duration > 7200) throw apiError_('INVALID_PHASES', 'La duración debe estar entre 1 y 7200 segundos.');
    const thresholds = phase.warningThresholdsSeconds;
    if (thresholds !== undefined && (!Array.isArray(thresholds) || thresholds.some(function (item) { return !Number.isFinite(Number(item)) || Number(item) < 0; }))) {
      throw apiError_('INVALID_PHASES', 'Los umbrales de aviso deben contener segundos válidos.');
    }
  });
}

/**
 * Public entry point shown in the Apps Script Run menu.
 * Safe to rerun: existing rows are retained and defaults are added only if absent.
 */
function setupSheets() {
  return setupSheets_();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LEDU Control')
    .addItem('Preparar hoja del torneo', 'setupSheets')
    .addToUi();
}

function setupSheets_() {
  const ss = spreadsheet_();
  Object.keys(SHEETS).forEach(function (name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = SHEETS[name];
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    else {
      const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
      if (headers.some(function (header, index) { return existing[index] !== header; })) {
        throw apiError_('SCHEMA_MISMATCH', 'La pestaña ' + name + ' tiene columnas distintas. No se sobrescriben datos.');
      }
    }
    sheet.setFrozenRows(1);
  });
  if (readObjects_('Config').length === 0) {
    writeObjects_('Config', [
      { key: 'tournamentName', value: 'Torneo LEDU' },
      { key: 'revision', value: '1' },
      { key: 'updatedAt', value: String(Date.now()) }
    ]);
  }
  if (!configValue_(readObjects_('Config'), 'formatPhases')) setConfig_('formatPhases', JSON.stringify(defaultPhases_()));

  // Bootstrap a usable first round and empty rooms only on a brand-new sheet.
  if (readObjects_('Rondas').length === 0) {
    writeObjects_('Rondas', [{ id: 'r1', number: 1, name: 'Ronda 1', active: true }]);
  }
  if (readObjects_('Salas').length === 0) {
    const phases = defaultPhases_();
    const rooms = ['a1', 'a2', 'a3', 'a4'].map(function (id, index) {
      return {
        id: id, name: 'Sala A' + (index + 1), roundId: 'r1', teamFavorId: '', teamContraId: '',
        judgeIds: '[]', status: 'unassigned', phases: JSON.stringify(phases), notes: '', updatedAt: Date.now()
      };
    });
    writeObjects_('Salas', rooms);
    writeObjects_('Cronometros', rooms.map(function (room) {
      const timer = initialTimer_(phases);
      return {
        roomId: room.id, status: timer.status, phaseIndex: timer.phaseIndex,
        remainingSeconds: timer.remainingSeconds, startedAt: '', lastResumedAt: '',
        revision: 0, updatedAt: timer.updatedAt
      };
    }));
  }

  SpreadsheetApp.flush();
  return {
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    sheets: Object.keys(SHEETS),
    defaultRoundsCreated: readObjects_('Rondas').length,
    defaultRoomsCreated: readObjects_('Salas').length
  };
}

function defaultPhases_() {
  return [
    { id: 'ledu-01', name: 'Exposición inicial', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 240, type: 'opening', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-02', name: 'Examen cruzado', side: 'contra', speaker: 'En contra pregunta a A favor', durationSeconds: 120, type: 'cross-examination', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-03', name: 'Exposición inicial', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 240, type: 'opening', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-04', name: 'Examen cruzado', side: 'favor', speaker: 'A favor pregunta a En contra', durationSeconds: 120, type: 'cross-examination', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-05', name: 'Refutación 1', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 300, type: 'rebuttal', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-06', name: 'Refutación 1', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 300, type: 'rebuttal', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-07', name: 'Refutación 2', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 300, type: 'rebuttal', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-08', name: 'Refutación 2', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 300, type: 'rebuttal', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-09', name: 'Refutación cruzada', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 90, type: 'cross-rebuttal', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-10', name: 'Refutación cruzada', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 90, type: 'cross-rebuttal', warningThresholdsSeconds: [30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-11', name: 'Conclusión', side: 'contra', speaker: 'Equipo en contra', durationSeconds: 180, type: 'conclusion', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true },
    { id: 'ledu-12', name: 'Conclusión', side: 'favor', speaker: 'Equipo a favor', durationSeconds: 180, type: 'conclusion', warningThresholdsSeconds: [60, 30, 10], allowOvertimeDisplay: true }
  ];
}

function spreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
  try {
    return SpreadsheetApp.openById(id);
  } catch (error) {
    throw apiError_('SPREADSHEET_ACCESS', 'No se ha podido abrir la hoja de cálculo configurada. Comprueba que la cuenta que ejecuta el script tiene acceso a la hoja ' + id + '.');
  }
}
function sheet_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw apiError_('NOT_INITIALIZED', 'Falta la pestaña ' + name + '. Recarga la hoja y ejecuta LEDU Control → Preparar hoja del torneo.');
  return sheet;
}
function readObjects_(name) {
  const values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(function (row) { return row.some(function (cell) { return cell !== ''; }); }).map(function (row) {
    const obj = {};
    headers.forEach(function (header, index) { obj[header] = row[index]; });
    return obj;
  });
}
function writeObjects_(name, objects) {
  const sheet = sheet_(name);
  const headers = SHEETS[name];
  const oldRows = Math.max(0, sheet.getLastRow() - 1);
  if (oldRows) sheet.getRange(2, 1, oldRows, headers.length).clearContent();
  if (objects.length) sheet.getRange(2, 1, objects.length, headers.length).setValues(objects.map(function (obj) {
    return headers.map(function (header) { const value = obj[header]; return value === undefined || value === null ? '' : value; });
  }));
}
function upsertById_(name, key, id, obj) {
  const sheet = sheet_(name);
  const rows = readObjects_(name);
  const index = rows.findIndex(function (row) { return String(row[key]) === String(id); });
  const headers = SHEETS[name];
  const values = headers.map(function (header) { const value = obj[header]; return value === undefined || value === null ? '' : value; });
  if (index < 0) sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([values]);
  else sheet.getRange(index + 2, 1, 1, headers.length).setValues([values]);
}
function configValue_(rows, key) { const item = rows.find(function (row) { return row.key === key; }); return item ? item.value : ''; }
function setConfig_(key, value) { upsertById_('Config', 'key', key, { key: key, value: value }); }
function deriveRoomStatus_(room) {
  if (room.timer && room.timer.status === 'running') return 'running';
  if (room.timer && room.timer.status === 'paused') return 'paused';
  if (room.timer && room.timer.status === 'finished') return 'finished';
  return room.teamFavorId && room.teamContraId && (room.judgeIds || []).length ? 'ready' : 'unassigned';
}
function timerFromRow_(row) {
  return { status: str_(row.status) || 'idle', phaseIndex: num_(row.phaseIndex), remainingSeconds: num_(row.remainingSeconds),
    startedAt: row.startedAt === '' ? null : num_(row.startedAt), lastResumedAt: row.lastResumedAt === '' ? null : num_(row.lastResumedAt),
    revision: num_(row.revision), updatedAt: num_(row.updatedAt) };
}
function initialTimer_(phases) {
  return { status: 'idle', phaseIndex: 0, remainingSeconds: phases.length ? num_(phases[0].durationSeconds) : 0,
    startedAt: null, lastResumedAt: null, revision: 0, updatedAt: Date.now() };
}
function remaining_(timer, now) {
  if (timer.status !== 'running' || timer.lastResumedAt === null) return num_(timer.remainingSeconds);
  return num_(timer.remainingSeconds) - Math.floor((now - timer.lastResumedAt) / 1000);
}
function transitionTimer_(timer, phases, action, now) {
  const phase = phases[timer.phaseIndex];
  if (action === 'finish') {
    if (timer.status === 'finished') return timer;
    return Object.assign({}, timer, { status: 'finished', remainingSeconds: 0, lastResumedAt: null, revision: timer.revision + 1, updatedAt: now });
  }
  if (action === 'reset') {
    if (!phase) return timer;
    return Object.assign({}, timer, { status: 'idle', remainingSeconds: num_(phase.durationSeconds), startedAt: null, lastResumedAt: null, revision: timer.revision + 1, updatedAt: now });
  }
  if (action === 'start') {
    if (timer.status === 'running' || timer.status === 'finished' || !phase) return timer;
    return Object.assign({}, timer, { status: 'running', startedAt: timer.startedAt || now, lastResumedAt: now, revision: timer.revision + 1, updatedAt: now });
  }
  if (action === 'pause') {
    if (timer.status !== 'running') return timer;
    return Object.assign({}, timer, { status: 'paused', remainingSeconds: remaining_(timer, now), lastResumedAt: null, revision: timer.revision + 1, updatedAt: now });
  }
  if (timer.status === 'finished') return timer;
  const index = action === 'previous' ? timer.phaseIndex - 1 : timer.phaseIndex + 1;
  if (index < 0) return timer;
  if (index >= phases.length) return Object.assign({}, timer, { status: 'finished', remainingSeconds: 0, lastResumedAt: null, revision: timer.revision + 1, updatedAt: now });
  return Object.assign({}, timer, { status: 'idle', phaseIndex: index, remainingSeconds: num_(phases[index].durationSeconds), startedAt: null, lastResumedAt: null, revision: timer.revision + 1, updatedAt: now });
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function apiError_(code, message) { const error = new Error(message); error.code = code; return error; }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function str_(value) { return value === null || value === undefined ? '' : String(value); }
function num_(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function bool_(value) { return value === true || String(value).toLowerCase() === 'true'; }
function parseJson_(value, fallback) {
  try { return typeof value === 'string' ? JSON.parse(value || JSON.stringify(fallback)) : (value || fallback); }
  catch (_) { return fallback; }
}
