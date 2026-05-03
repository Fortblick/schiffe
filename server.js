// ===========================================================================
// Schiffe versenken — Multi-Player (bis 10 Spieler + unbegrenzte Zuschauer)
// Express + WebSockets, Runden-basiert, Echtzeit
// ===========================================================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ===== Konstanten =====
const BOARD_SIZE = 10;
const SHIPS_PER_PLAYER = 10;
const MAX_PLAYERS = 10;
const ROUND_DURATION_MS = 30 * 1000;
const DISCONNECT_GRACE_MS = 30 * 1000; // 30s Pause bei Disconnect

/**
 * rooms: Map<code, Room>
 * Room: {
 *   code,
 *   phase: 'lobby' | 'placing' | 'playing' | 'finished',
 *   players: Map<playerId, Player>,
 *   spectators: Map<spectatorId, Spectator>,
 *   roundNumber, roundStartTime, roundTimer,
 *   pauseUntil, pauseTimer,
 *   winner, lastActivity
 * }
 *
 * Player: { id, ws, name, role: 'player', ready, ships: Set<"r,c">,
 *   shotThisRound: "r,c"|null, alive: boolean,
 *   stonesAlive: number (computed), connected: boolean,
 *   disconnectedSince: number|null }
 *
 * Spectator: { id, ws, name }
 *
 * RoundReveal: pro Runde - {round, shots: Array<{shooterName, cell, hits: [{playerName}], isMiss}>}
 */
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function makeId() {
  return Math.random().toString(36).substring(2, 14);
}

function send(ws, type, data = {}) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

// ===== Zustandsbau für Client =====

function publicPlayerInfo(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    initial: player.initial,
    ready: player.ready,
    alive: player.alive,
    stonesAlive: player.alive ? (SHIPS_PER_PLAYER - player.shipsHit.size) : 0,
    connected: player.connected,
    hasShotThisRound: !!player.shotThisRound
  };
}

function buildRoomStateFor(room, viewerId, viewerKind) {
  // viewerKind: 'player' | 'spectator'
  const players = Array.from(room.players.values()).map(publicPlayerInfo);
  const spectatorCount = room.spectators.size;

  // Statt Restzeit zu schicken, schicken wir absoluten End-Zeitstempel.
  // Der Client zählt lokal runter -> kein UI-Flackern jede Sekunde nötig.
  const roundEndsAt = (room.phase === 'playing' && room.roundStartTime)
    ? room.roundStartTime + ROUND_DURATION_MS
    : null;

  const pauseEndsAt = room.pauseUntil || null;

  // Welche Felder wurden in der LAUFENDEN Runde schon beschossen (von wem),
  // OHNE Treffer-Info zu verraten - die kommt erst in der Auflösung.
  // So sieht man, wo man nicht mehr klicken muss.
  const roundShots = [];
  if (room.phase === 'playing') {
    for (const p of room.players.values()) {
      if (p.alive && p.shotThisRound) {
        roundShots.push({
          shooterId: p.id,
          shooterName: p.name,
          shooterColor: p.color,
          shooterInitial: p.initial,
          cell: p.shotThisRound
        });
      }
    }
  }

  const base = {
    code: room.code,
    phase: room.phase,
    players,
    spectatorCount,
    roundNumber: room.roundNumber,
    roundEndsAt,
    paused: room.pauseUntil != null,
    pauseEndsAt,
    serverTime: Date.now(),
    pausedFor: room.pausedFor || null,
    winner: room.winner || null,
    viewerKind,
    roundShots,
    lastReveal: room.lastReveal || null  // Auflösung der letzten Runde
  };

  if (viewerKind === 'player') {
    const me = room.players.get(viewerId);
    if (!me) return base;
    return {
      ...base,
      yourId: me.id,
      yourName: me.name,
      yourReady: me.ready,
      yourShips: Array.from(me.ships),
      yourShipsHit: Array.from(me.shipsHit),
      yourAlive: me.alive,
      yourShotThisRound: me.shotThisRound,
      // Was *du* in den Auflösungen gesehen hast — alle Treffer/Misses werden eh allen gezeigt
    };
  } else {
    // Zuschauer
    const me = room.spectators.get(viewerId);
    return {
      ...base,
      yourName: me?.name || 'Zuschauer',
      // KEIN yourShips - Zuschauer sehen keine Steinpositionen
    };
  }
}

function broadcastRoom(room) {
  for (const p of room.players.values()) {
    send(p.ws, 'state', { state: buildRoomStateFor(room, p.id, 'player') });
  }
  for (const s of room.spectators.values()) {
    send(s.ws, 'state', { state: buildRoomStateFor(room, s.id, 'spectator') });
  }
}

// ===== Spiellogik =====

// 10 deutlich unterscheidbare Farben für bis zu 10 Spieler
const PLAYER_COLORS = [
  '#7DD3FC', // Hellblau (Akzent)
  '#FCA5A5', // Rosa-Rot
  '#86EFAC', // Hellgrün
  '#FCD34D', // Gelb
  '#C4B5FD', // Lavendel
  '#FDBA74', // Orange
  '#67E8F9', // Cyan
  '#F9A8D4', // Pink
  '#FDE68A', // Sandgelb
  '#A7F3D0'  // Mint
];

function pickColor(room) {
  const used = new Set(Array.from(room.players.values()).map(p => p.color));
  for (const c of PLAYER_COLORS) {
    if (!used.has(c)) return c;
  }
  return PLAYER_COLORS[0];
}

function newPlayer(id, ws, name, color) {
  return {
    id, ws, name,
    color: color || PLAYER_COLORS[0],
    initial: (name || '?').charAt(0).toUpperCase(),
    role: 'player',
    ready: false,
    ships: new Set(),
    shipsHit: new Set(),  // welche meiner Steine getroffen wurden
    shotThisRound: null,
    alive: true,
    connected: true,
    disconnectedSince: null
  };
}

function newSpectator(id, ws, name) {
  return { id, ws, name, role: 'spectator' };
}

function startGameIfReady(room) {
  if (room.phase !== 'lobby') return;
  const players = Array.from(room.players.values());
  if (players.length < 2) return;
  if (!players.every(p => p.ready)) return;

  // Reset für neues Spiel
  for (const p of players) {
    p.ships = new Set();
    p.shipsHit = new Set();
    p.alive = true;
    p.shotThisRound = null;
    p.ready = false; // wird für Platzierungs-Phase neu gebraucht
  }
  room.phase = 'placing';
  room.roundNumber = 0;
  room.lastReveal = null;
  room.winner = null;
  broadcastRoom(room);
}

function startPlayingIfReady(room) {
  if (room.phase !== 'placing') return;
  const alive = Array.from(room.players.values());
  if (!alive.every(p => p.ready)) return;

  room.phase = 'playing';
  room.roundNumber = 1;
  startRound(room);
}

function startRound(room) {
  room.roundStartTime = Date.now();
  for (const p of room.players.values()) {
    p.shotThisRound = null;
  }
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => resolveRound(room), ROUND_DURATION_MS + 100);
  broadcastRoom(room);
  // Periodisches Update für Countdown alle 1s
  scheduleCountdownTick(room);
}

function scheduleCountdownTick(room) {
  // Nicht mehr nötig — Client zählt lokal runter mit absoluten Zeitstempeln (roundEndsAt).
  // Wir broadcasten nur noch bei echten State-Änderungen (Schuss, Beitritt, etc.),
  // nicht jede Sekunde. Verhindert UI-Flackern.
}

function resolveRound(room) {
  if (room.phase !== 'playing') return;
  if (room.pauseUntil) return; // aktuell pausiert -> später erneut versuchen

  // Schüsse einsammeln
  const shots = [];
  for (const p of room.players.values()) {
    if (p.alive && p.shotThisRound) {
      shots.push({
        shooterId: p.id,
        shooterName: p.name,
        shooterColor: p.color,
        shooterInitial: p.initial,
        cell: p.shotThisRound
      });
    }
  }

  // Auflösung: pro Schuss prüfen wer dort getroffen wurde
  const reveal = {
    round: room.roundNumber,
    shots: []
  };
  // Sammle Treffer pro Spieler
  const eliminationsThisRound = [];
  for (const shot of shots) {
    const hits = []; // Liste von {playerName, playerColor} die getroffen wurden
    for (const target of room.players.values()) {
      if (!target.alive) continue;
      if (target.id === shot.shooterId) continue; // sich selbst nicht treffen
      if (target.ships.has(shot.cell) && !target.shipsHit.has(shot.cell)) {
        target.shipsHit.add(shot.cell);
        hits.push({
          playerName: target.name,
          playerId: target.id,
          playerColor: target.color
        });
        // Prüfen ob ausgeschieden
        if (target.shipsHit.size >= SHIPS_PER_PLAYER) {
          target.alive = false;
          eliminationsThisRound.push(target.name);
        }
      }
    }
    reveal.shots.push({
      shooterId: shot.shooterId,
      shooterName: shot.shooterName,
      shooterColor: shot.shooterColor,
      shooterInitial: shot.shooterInitial,
      cell: shot.cell,
      hits,
      hitCount: hits.length
    });
  }
  reveal.eliminations = eliminationsThisRound;
  room.lastReveal = reveal;

  // Sieg-Bedingung prüfen
  const aliveAfter = Array.from(room.players.values()).filter(p => p.alive);
  if (aliveAfter.length <= 1) {
    room.phase = 'finished';
    room.winner = aliveAfter.length === 1 ? aliveAfter[0].name : null;
    // Alle Schiffspositionen aufdecken
    room.allShipsRevealed = Array.from(room.players.values()).map(p => ({
      name: p.name,
      ships: Array.from(p.ships)
    }));
    broadcastRoom(room);
    if (room.tickTimer) clearTimeout(room.tickTimer);
    if (room.roundTimer) clearTimeout(room.roundTimer);
    return;
  }

  // Nächste Runde
  room.roundNumber++;
  startRound(room);
}

function maybeEarlyResolve(room) {
  // Alle lebenden Spieler haben geschossen?
  const alive = Array.from(room.players.values()).filter(p => p.alive && p.connected);
  if (alive.length === 0) return;
  if (alive.every(p => !!p.shotThisRound)) {
    // Sofort auflösen
    if (room.roundTimer) clearTimeout(room.roundTimer);
    resolveRound(room);
  }
}

// ===== Pause-Logik bei Disconnect =====

function pauseRoom(room, playerName) {
  if (room.phase !== 'playing') return;
  if (room.pauseUntil) return;
  room.pauseUntil = Date.now() + DISCONNECT_GRACE_MS;
  room.pausedFor = playerName;
  // Roundtimer aussetzen
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
    // Verbleibende Zeit notieren
    const elapsed = Date.now() - room.roundStartTime;
    room.roundRemaining = Math.max(0, ROUND_DURATION_MS - elapsed);
  }
  if (room.tickTimer) clearTimeout(room.tickTimer);

  room.pauseTimer = setTimeout(() => endPause(room, true), DISCONNECT_GRACE_MS + 50);
  broadcastRoom(room);
  schedulePauseCountdownTick(room);
}

function schedulePauseCountdownTick(room) {
  // Nicht mehr nötig — Client zählt lokal runter, sieht pauseEndsAt im State.
}

function endPause(room, eliminateDisconnected) {
  room.pauseUntil = null;
  const pausedName = room.pausedFor;
  room.pausedFor = null;
  if (room.pauseTimer) { clearTimeout(room.pauseTimer); room.pauseTimer = null; }

  if (eliminateDisconnected) {
    // Wer noch nicht zurückgekommen ist, scheidet aus
    for (const p of room.players.values()) {
      if (!p.connected) {
        p.alive = false;
      }
    }
    // Sieg prüfen
    const alive = Array.from(room.players.values()).filter(p => p.alive);
    if (alive.length <= 1) {
      room.phase = 'finished';
      room.winner = alive.length === 1 ? alive[0].name : null;
      room.allShipsRevealed = Array.from(room.players.values()).map(p => ({
        name: p.name,
        ships: Array.from(p.ships)
      }));
      broadcastRoom(room);
      return;
    }
  }

  // Runde fortsetzen
  if (room.phase === 'playing') {
    const remaining = room.roundRemaining || ROUND_DURATION_MS;
    room.roundStartTime = Date.now() - (ROUND_DURATION_MS - remaining);
    room.roundTimer = setTimeout(() => resolveRound(room), remaining + 100);
    scheduleCountdownTick(room);
  }
  broadcastRoom(room);
}

// ===== Validierung =====

function validShipsArray(arr) {
  if (!Array.isArray(arr)) return false;
  if (arr.length !== SHIPS_PER_PLAYER) return false;
  if (new Set(arr).size !== SHIPS_PER_PLAYER) return false;
  return arr.every(c => {
    if (typeof c !== 'string' || !/^\d+,\d+$/.test(c)) return false;
    const [r, col] = c.split(',').map(Number);
    return r >= 0 && r < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
  });
}

function validCell(c) {
  if (typeof c !== 'string' || !/^\d+,\d+$/.test(c)) return false;
  const [r, col] = c.split(',').map(Number);
  return r >= 0 && r < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

// ===== Message-Handler =====

function handleMessage(ws, msg, ctx) {
  const { type } = msg;

  if (type === 'create_room') {
    const name = (msg.name || '').toString().trim().slice(0, 20) || 'Spieler';
    const code = makeCode();
    const playerId = makeId();
    const room = {
      code,
      phase: 'lobby',
      players: new Map(),
      spectators: new Map(),
      roundNumber: 0,
      roundStartTime: null,
      lastActivity: Date.now()
    };
    room.players.set(playerId, newPlayer(playerId, ws, name, PLAYER_COLORS[0]));
    rooms.set(code, room);
    ctx.id = playerId;
    ctx.kind = 'player';
    ctx.code = code;
    send(ws, 'joined', { id: playerId, code, kind: 'player', name });
    broadcastRoom(room);
    console.log(`[${code}] Raum erstellt von ${name}`);
    return;
  }

  if (type === 'join_room') {
    const code = (msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      send(ws, 'error', { message: 'Raum nicht gefunden.' });
      return;
    }
    const asSpectator = msg.as === 'spectator';
    const name = (msg.name || '').toString().trim().slice(0, 20) || (asSpectator ? 'Zuschauer' : 'Spieler');

    // Re-Connect über bekannte ID
    if (msg.existingId) {
      const existingPlayer = room.players.get(msg.existingId);
      if (existingPlayer) {
        existingPlayer.ws = ws;
        existingPlayer.connected = true;
        existingPlayer.disconnectedSince = null;
        ctx.id = existingPlayer.id;
        ctx.kind = 'player';
        ctx.code = code;
        send(ws, 'joined', { id: existingPlayer.id, code, kind: 'player', name: existingPlayer.name });
        // Wenn dieser Spieler die Pause ausgelöst hatte, evtl. fortsetzen
        if (room.pauseUntil && room.pausedFor === existingPlayer.name) {
          // Prüfen ob alle anderen connected sind
          const allConnected = Array.from(room.players.values()).filter(p => p.alive).every(p => p.connected);
          if (allConnected) endPause(room, false);
        }
        broadcastRoom(room);
        console.log(`[${code}] Re-Connect: ${existingPlayer.name}`);
        return;
      }
      const existingSpec = room.spectators.get(msg.existingId);
      if (existingSpec) {
        existingSpec.ws = ws;
        ctx.id = existingSpec.id;
        ctx.kind = 'spectator';
        ctx.code = code;
        send(ws, 'joined', { id: existingSpec.id, code, kind: 'spectator', name: existingSpec.name });
        broadcastRoom(room);
        return;
      }
    }

    if (asSpectator) {
      // Zuschauer: jederzeit erlaubt, keine Begrenzung
      const id = makeId();
      room.spectators.set(id, newSpectator(id, ws, name));
      ctx.id = id;
      ctx.kind = 'spectator';
      ctx.code = code;
      send(ws, 'joined', { id, code, kind: 'spectator', name });
      broadcastRoom(room);
      console.log(`[${code}] Zuschauer: ${name}`);
      return;
    }

    // Spieler beitreten
    if (room.phase !== 'lobby') {
      send(ws, 'error', { message: 'Spiel läuft bereits. Du kannst nur als Zuschauer beitreten.' });
      return;
    }
    if (room.players.size >= MAX_PLAYERS) {
      send(ws, 'error', { message: `Raum ist voll (max. ${MAX_PLAYERS} Spieler). Du kannst als Zuschauer beitreten.` });
      return;
    }
    // Name-Eindeutigkeit
    let finalName = name;
    let suffix = 1;
    while (Array.from(room.players.values()).some(p => p.name === finalName)) {
      suffix++;
      finalName = `${name} ${suffix}`;
    }
    const id = makeId();
    const color = pickColor(room);
    room.players.set(id, newPlayer(id, ws, finalName, color));
    ctx.id = id;
    ctx.kind = 'player';
    ctx.code = code;
    send(ws, 'joined', { id, code, kind: 'player', name: finalName });
    broadcastRoom(room);
    console.log(`[${code}] Spieler: ${finalName}`);
    return;
  }

  // Ab hier: muss in einem Raum sein
  const room = rooms.get(ctx.code);
  if (!room) return;
  room.lastActivity = Date.now();

  if (type === 'set_ready') {
    if (ctx.kind !== 'player') return;
    if (room.phase !== 'lobby') return;
    const me = room.players.get(ctx.id);
    if (!me) return;
    me.ready = !!msg.ready;
    broadcastRoom(room);
    startGameIfReady(room);
    return;
  }

  if (type === 'set_ships') {
    if (ctx.kind !== 'player') return;
    if (room.phase !== 'placing') return;
    const me = room.players.get(ctx.id);
    if (!me || me.ready) return;
    if (!validShipsArray(msg.ships)) {
      send(ws, 'error', { message: `Ungültige Platzierung. ${SHIPS_PER_PLAYER} verschiedene Felder im ${BOARD_SIZE}×${BOARD_SIZE}-Raster.` });
      return;
    }
    me.ships = new Set(msg.ships);
    me.ready = true;
    broadcastRoom(room);
    startPlayingIfReady(room);
    return;
  }

  if (type === 'shoot') {
    if (ctx.kind !== 'player') return;
    if (room.phase !== 'playing') return;
    if (room.pauseUntil) return; // pausiert
    const me = room.players.get(ctx.id);
    if (!me || !me.alive) return;
    if (me.shotThisRound) {
      send(ws, 'error', { message: 'Du hast in dieser Runde schon geschossen.' });
      return;
    }
    if (!validCell(msg.cell)) return;
    me.shotThisRound = msg.cell;
    broadcastRoom(room);
    maybeEarlyResolve(room);
    return;
  }

  if (type === 'play_again') {
    // Im finished-Zustand: zurück in die Lobby
    if (ctx.kind !== 'player') return;
    if (room.phase !== 'finished') return;
    room.phase = 'lobby';
    room.winner = null;
    room.lastReveal = null;
    room.allShipsRevealed = null;
    for (const p of room.players.values()) {
      p.ships = new Set();
      p.shipsHit = new Set();
      p.alive = true;
      p.ready = false;
      p.shotThisRound = null;
    }
    broadcastRoom(room);
    return;
  }

  if (type === 'leave_room') {
    leavePlayer(ctx);
    return;
  }
}

function leavePlayer(ctx) {
  const room = rooms.get(ctx.code);
  if (!room) return;
  if (ctx.kind === 'player') {
    const p = room.players.get(ctx.id);
    if (!p) return;
    if (room.phase === 'lobby' || room.phase === 'finished') {
      room.players.delete(ctx.id);
    } else if (room.phase === 'placing') {
      // In Platzierungsphase: einfach raus
      room.players.delete(ctx.id);
      // Wenn keine 2 Spieler mehr -> zurück Lobby
      if (room.players.size < 2) {
        room.phase = 'lobby';
        for (const pp of room.players.values()) {
          pp.ready = false;
          pp.ships = new Set();
        }
      } else {
        startPlayingIfReady(room);
      }
    } else if (room.phase === 'playing') {
      // Mitten im Spiel: ausgeschieden
      p.alive = false;
      p.connected = false;
    }
    broadcastRoom(room);
  } else {
    room.spectators.delete(ctx.id);
    broadcastRoom(room);
  }
}

// ===== WebSocket-Lifecycle =====

wss.on('connection', (ws) => {
  const ctx = { id: null, kind: null, code: null };

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try { handleMessage(ws, msg, ctx); }
    catch (err) {
      console.error('Handler-Fehler:', err);
      send(ws, 'error', { message: 'Server-Fehler.' });
    }
  });

  ws.on('close', () => {
    if (!ctx.code) return;
    const room = rooms.get(ctx.code);
    if (!room) return;

    if (ctx.kind === 'spectator') {
      room.spectators.delete(ctx.id);
      broadcastRoom(room);
      return;
    }

    // Spieler disconnected
    const p = room.players.get(ctx.id);
    if (!p) return;
    p.connected = false;
    p.disconnectedSince = Date.now();

    if (room.phase === 'lobby' || room.phase === 'placing') {
      // Direkt entfernen in Lobby/Platzierung (keine Pause-Mechanik)
      room.players.delete(ctx.id);
      if (room.phase === 'placing' && room.players.size < 2) {
        room.phase = 'lobby';
        for (const pp of room.players.values()) {
          pp.ready = false;
          pp.ships = new Set();
        }
      }
      broadcastRoom(room);
      return;
    }

    if (room.phase === 'playing') {
      // Pause auslösen wenn der Spieler noch lebt
      if (p.alive) {
        pauseRoom(room, p.name);
      } else {
        broadcastRoom(room);
      }
      return;
    }

    broadcastRoom(room);
  });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Aufräumen alter Räume (4h Inaktivität)
setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.lastActivity < cutoff) {
      if (room.roundTimer) clearTimeout(room.roundTimer);
      if (room.tickTimer) clearTimeout(room.tickTimer);
      if (room.pauseTimer) clearTimeout(room.pauseTimer);
      rooms.delete(code);
      console.log(`[${code}] Raum gelöscht (inaktiv)`);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Multi-Server läuft auf Port ${PORT}`));
