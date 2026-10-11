/**
 * LEDU Control — Google Apps Script backend.
 * Script Properties required: SPREADSHEET_ID, ADMIN_PASSWORD.
 * Never use the demo password as a production credential.
 */
const SHEETS = {
  Config: ['key', 'value'],
  Rondas: ['id', 'number', 'name', 'active'],
  Equipos: ['id', 'name', 'institution', 'active'],
  Jueces: ['id', 'name', 'institution', 'active'],
  Salas: ['id', 'name', 'roundId', 'teamFavorId', 'teamContraId', 'judgeIds', 'status', 'phases', 'notes', 'updatedAt'],
  Cronometros: ['roomId', 'status', 'phaseIndex', 'remainingSeconds', 'startedAt', 'lastResumedAt', 'revision', 'updatedAt']
};
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function doGet(e) {
  const action = String(e && e.parameter && e.parameter.action || '');
  if (action === 'health') return json_({ ok: true, data: { status: 'ok', now: Date.now() } });
  return json_({ ok: false, error: { code: 'POST_REQUIRED', message: 'Utiliza POST para las operaciones de la API.' } });
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
    revision: num_(configValue_(config, 'revision')) || 1,
    updatedAt: num_(configValue_(config, 'updatedAt')) || Date.now()
  };
}

function getPublicRoom_(roomId) {
  if (!roomId) throw apiError_('INVALID_ROOM', 'Falta el identificador de sala.');
  const tournament = readTournament_();
  const room = tournament.rooms.find(function (r) { return r.id === roomId; });
  if (!room) throw apiError_('ROOM_NOT_FOUND', 'No se encuentra esa sala.');
  const round = tournament.rounds.find(function (r) { return r.id === room.roundId; });
  const favor = tournament.teams.find(function (t) { return t.id === room.teamFavorId; });
  const contra = tournament.teams.find(function (t) { return t.id === room.teamContraId; });
  const judges = room.judgeIds.map(function (id) {
    const judge = tournament.judges.find(function (j) { return j.id === id; });
    return judge ? judge.name : '';
  }).filter(Boolean);
  return {
    tournamentName: tournament.tournamentName, roundName: round ? round.name : '',
    room: room, teamFavor: favor ? favor.name : '', teamContra: contra ? contra.name : '',
    judges: judges, serverTime: Date.now()
  };
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
    const currentRevision = num_(configValue_(readObjects_('Config'), 'revision')) || 1;
    if (num_(p.expectedRevision) !== currentRevision) {
      throw apiError_('REVISION_CONFLICT', 'El torneo cambió en otro dispositivo. Actualiza los datos antes de guardar.');
    }
    validateAssignments_(input);
    writeObjects_('Rondas', input.rounds.map(function (r) { return { id: r.id, number: r.number, name: r.name, active: r.active }; }));
    writeObjects_('Equipos', input.teams.map(function (t) { return { id: t.id, name: t.name, institution: t.institution, active: t.active }; }));
    writeObjects_('Jueces', input.judges.map(function (j) { return { id: j.id, name: j.name, institution: j.institution, active: j.active }; }));
    writeObjects_('Salas', input.rooms.map(function (r) {
      return { id: r.id, name: r.name, roundId: r.roundId, teamFavorId: r.teamFavorId || '',
        teamContraId: r.teamContraId || '', judgeIds: JSON.stringify(r.judgeIds || []),
        status: deriveRoomStatus_(r), phases: JSON.stringify(r.phases || []), notes: r.notes || '', updatedAt: Date.now() };
    }));
    writeObjects_('Cronometros', input.rooms.map(function (r) {
      const t = r.timer || initialTimer_(r.phases || []);
      return { roomId: r.id, status: t.status, phaseIndex: t.phaseIndex, remainingSeconds: t.remainingSeconds,
        startedAt: t.startedAt || '', lastResumedAt: t.lastResumedAt || '', revision: t.revision || 0, updatedAt: t.updatedAt || Date.now() };
    }));
    const nextRevision = currentRevision + 1;
    setConfig_('tournamentName', input.tournamentName || 'Torneo LEDU');
    setConfig_('revision', String(nextRevision));
    setConfig_('updatedAt', String(Date.now()));
    SpreadsheetApp.flush();
    return readTournament_();
  } finally { lock.releaseLock(); }
}

function updateRoomTimer_(p) {
  const roomId = String(p.roomId || '');
  const action = String(p.action || '');
  if (['start', 'pause', 'reset', 'next'].indexOf(action) < 0) throw apiError_('INVALID_ACTION', 'Acción de cronómetro no válida.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rooms = readObjects_('Salas');
    const row = rooms.find(function (r) { return String(r.id) === roomId; });
    if (!row) throw apiError_('ROOM_NOT_FOUND', 'No se encuentra esa sala.');
    const timerRows = readObjects_('Cronometros');
    const stored = timerRows.find(function (t) { return String(t.roomId) === roomId; });
    const phases = parseJson_(row.phases, []);
    const timer = stored ? timerFromRow_(stored) : initialTimer_(phases);
    if (p.expectedRevision !== undefined && num_(p.expectedRevision) !== timer.revision) {
      throw apiError_('REVISION_CONFLICT', 'El cronómetro recibió otra acción. Actualiza el estado.');
    }
    const next = transitionTimer_(timer, phases, action, Date.now());
    upsertById_('Cronometros', 'roomId', roomId, {
      roomId: roomId, status: next.status, phaseIndex: next.phaseIndex,
      remainingSeconds: next.remainingSeconds, startedAt: next.startedAt || '',
      lastResumedAt: next.lastResumedAt || '', revision: next.revision, updatedAt: next.updatedAt
    });
    upsertById_('Salas', 'id', roomId, Object.assign({}, row, { status: deriveRoomStatus_(Object.assign({}, row, { timer: next })), updatedAt: Date.now() }));
    SpreadsheetApp.flush();
    // Intentionally call the non-locking read function while the script lock is held.
    return publicRoomFromTournament_(roomId, readTournament_());
  } finally { lock.releaseLock(); }
}

function publicRoomFromTournament_(roomId, tournament) {
  const room = tournament.rooms.find(function (r) { return r.id === roomId; });
  if (!room) throw apiError_('ROOM_NOT_FOUND', 'No se encuentra esa sala.');
  const round = tournament.rounds.find(function (r) { return r.id === room.roundId; });
  const favor = tournament.teams.find(function (t) { return t.id === room.teamFavorId; });
  const contra = tournament.teams.find(function (t) { return t.id === room.teamContraId; });
  const judges = room.judgeIds.map(function (id) { const item = tournament.judges.find(function (j) { return j.id === id; }); return item ? item.name : ''; }).filter(Boolean);
  return { tournamentName: tournament.tournamentName, roundName: round ? round.name : '', room: room, teamFavor: favor ? favor.name : '', teamContra: contra ? contra.name : '', judges: judges, serverTime: Date.now() };
}

function validateAssignments_(t) {
  const teamIds = new Set(t.teams.map(function (item) { return item.id; }));
  const judgeIds = new Set(t.judges.map(function (item) { return item.id; }));
  const teamBookings = {};
  const judgeBookings = {};
  t.rooms.forEach(function (room) {
    if (room.teamFavorId && room.teamFavorId === room.teamContraId) throw apiError_('INVALID_ASSIGNMENT', 'Un equipo no puede debatir contra sí mismo.');
    [room.teamFavorId, room.teamContraId].filter(Boolean).forEach(function (id) {
      if (!teamIds.has(id)) throw apiError_('INVALID_ASSIGNMENT', 'Una sala contiene un equipo inexistente.');
      const key = room.roundId + ':' + id;
      if (teamBookings[key]) throw apiError_('TEAM_DOUBLE_BOOKED', 'Un equipo está asignado a dos salas de la misma ronda.');
      teamBookings[key] = true;
    });
    (room.judgeIds || []).forEach(function (id) {
      if (!judgeIds.has(id)) throw apiError_('INVALID_ASSIGNMENT', 'Una sala contiene un juez inexistente.');
      const key = room.roundId + ':' + id;
      if (judgeBookings[key]) throw apiError_('JUDGE_DOUBLE_BOOKED', 'Un juez está asignado a dos salas de la misma ronda.');
      judgeBookings[key] = true;
    });
    if (!Array.isArray(room.phases) || !room.phases.length) throw apiError_('INVALID_PHASES', 'Cada sala debe tener al menos una fase de debate.');
  });
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
  return { spreadsheetName: ss.getName(), sheets: Object.keys(SHEETS) };
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw apiError_('NOT_CONFIGURED', 'Configura SPREADSHEET_ID en las propiedades del script.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw apiError_('NOT_INITIALIZED', 'Falta la pestaña ' + name + '. Ejecuta setupSheets_ desde el editor de Apps Script.');
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
  if (timer.status !== 'running' || timer.lastResumedAt === null) return Math.max(0, timer.remainingSeconds);
  return Math.max(0, timer.remainingSeconds - Math.floor((now - timer.lastResumedAt) / 1000));
}
function transitionTimer_(timer, phases, action, now) {
  const phase = phases[timer.phaseIndex];
  if (action === 'reset') {
    const fresh = initialTimer_(phases);
    fresh.updatedAt = now;
    fresh.revision = timer.revision + 1;
    return fresh;
  }
  if (action === 'start') {
    if (timer.status === 'running' || timer.status === 'finished' || !phase) return timer;
    const rest = timer.status === 'paused' ? remaining_(timer, now) : (timer.remainingSeconds || num_(phase.durationSeconds));
    return Object.assign({}, timer, { status: 'running', remainingSeconds: rest, startedAt: timer.startedAt || now, lastResumedAt: now, revision: timer.revision + 1, updatedAt: now });
  }
  if (action === 'pause') {
    if (timer.status !== 'running') return timer;
    return Object.assign({}, timer, { status: 'paused', remainingSeconds: remaining_(timer, now), lastResumedAt: null, revision: timer.revision + 1, updatedAt: now });
  }
  const index = timer.phaseIndex + 1;
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
