// ===========================================================================
// Schiffe versenken — Multi-Player Frontend
// ===========================================================================

const BOARD_SIZE = 10;
const SHIPS_PER_PLAYER = 10;

const $app = document.getElementById('app');

let ws = null;
let connected = false;
let serverState = null;
let me = {
  id: localStorage.getItem('multiId') || null,
  kind: localStorage.getItem('multiKind') || null,
  code: sessionStorage.getItem('multiCode') || null,
  name: localStorage.getItem('multiName') || ''
};

// Lokale Steine vor "Bereit"
let localShips = new Set();

// Lokal: Reveal anzeigen wir manuell, damit der Spieler ein paar Sekunden Zeit hat
let revealShownForRound = -1;

// Lobby-Form-State (vor Verbindung zum Raum)
let lobbyForm = {
  mode: 'choose', // choose | create | join | join-pick-role
  joinCode: '',
  joinAs: 'player',
  pendingName: ''
};

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function connect() {
  ws = new WebSocket(getWsUrl());
  ws.addEventListener('open', () => {
    connected = true;
    // Wenn wir noch in einem Raum waren, versuchen wir Re-Connect
    if (me.id && me.code) {
      send('join_room', {
        code: me.code,
        existingId: me.id,
        as: me.kind === 'spectator' ? 'spectator' : 'player',
        name: me.name
      });
    }
    render();
  });
  ws.addEventListener('close', () => {
    connected = false;
    render();
    setTimeout(connect, 2000);
  });
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    onServerMessage(msg);
  });
}

function send(type, data = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

function onServerMessage(msg) {
  if (msg.type === 'joined') {
    me.id = msg.id;
    me.code = msg.code;
    me.kind = msg.kind;
    me.name = msg.name;
    localStorage.setItem('multiId', me.id);
    localStorage.setItem('multiKind', me.kind);
    localStorage.setItem('multiName', me.name);
    sessionStorage.setItem('multiCode', me.code);
    return;
  }
  if (msg.type === 'state') {
    serverState = msg.state;
    render();
    return;
  }
  if (msg.type === 'error') {
    showToast(msg.message || 'Fehler');
    return;
  }
}

function showToast(text, kind = 'error') {
  const t = document.createElement('div');
  t.className = 'toast';
  if (kind === 'info') t.style.borderColor = 'var(--accent)';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function leaveRoom() {
  send('leave_room');
  me.id = null;
  me.code = null;
  me.kind = null;
  localStorage.removeItem('multiId');
  localStorage.removeItem('multiKind');
  sessionStorage.removeItem('multiCode');
  serverState = null;
  localShips.clear();
  lobbyForm = { mode: 'choose', joinCode: '', joinAs: 'player', pendingName: me.name || '' };
  render();
}

// ===== Render-Helfer =====
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'onclick') e.addEventListener('click', v);
    else if (k === 'oninput') e.addEventListener('input', v);
    else if (k === 'onkeydown') e.addEventListener('keydown', v);
    else if (k === 'style') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return e;
}

function fmtTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${s}s`;
}

// ===== Render =====
function render() {
  $app.innerHTML = '';

  const cs = el('div', { class: 'connection-status' });
  cs.innerHTML = connected
    ? `<span class="dot online"></span>VERBUNDEN`
    : `<span class="dot offline"></span>VERBINDE…`;
  $app.appendChild(cs);

  if (!connected) { renderConnecting(); return; }
  if (!serverState) { renderHome(); return; }

  switch (serverState.phase) {
    case 'lobby':    renderLobby(); break;
    case 'placing':  renderPlacement(); break;
    case 'playing':
    case 'finished': renderGame(); break;
  }
}

function renderConnecting() {
  $app.appendChild(el('div', { class: 'screen lobby-screen fade-in' },
    el('div', { class: 'label-md' }, 'VERBINDE'),
    el('h1', { class: 'title' }, 'Server wird kontaktiert…')
  ));
}

function renderHome() {
  if (lobbyForm.mode === 'choose') {
    renderHomeChoose();
  } else if (lobbyForm.mode === 'create') {
    renderHomeCreate();
  } else if (lobbyForm.mode === 'join') {
    renderHomeJoin();
  }
}

function renderHomeChoose() {
  const screen = el('div', { class: 'screen lobby-screen fade-in' });
  screen.appendChild(el('div', { class: 'label-md' }, 'SCHIFFE VERSENKEN'));
  screen.appendChild(el('h1', { class: 'title' }, 'Online — bis zu 10 Spieler'));
  screen.appendChild(el('p', { class: 'muted' },
    'Erstelle einen Raum oder tritt einem bei. Spielen oder zuschauen.'));

  screen.appendChild(el('div', { class: 'spacer-lg' }));

  screen.appendChild(el('button', {
    class: 'btn',
    onclick: () => { lobbyForm.mode = 'create'; render(); }
  }, 'Neuen Raum erstellen'));

  screen.appendChild(el('div', { class: 'spacer-md' }));

  screen.appendChild(el('button', {
    class: 'btn btn-secondary',
    onclick: () => { lobbyForm.mode = 'join'; render(); }
  }, 'Raum beitreten'));

  $app.appendChild(screen);
}

function renderHomeCreate() {
  const screen = el('div', { class: 'screen lobby-screen fade-in' });
  screen.appendChild(el('div', { class: 'label-md' }, 'NEUER RAUM'));
  screen.appendChild(el('h1', { class: 'title' }, 'Wie heißt du?'));
  screen.appendChild(el('p', { class: 'muted' }, 'Dein Name ist für alle anderen sichtbar.'));

  screen.appendChild(el('div', { class: 'spacer-md' }));

  const nameInput = el('input', {
    class: 'input-text',
    type: 'text',
    placeholder: 'Dein Name',
    maxlength: '20',
    value: lobbyForm.pendingName
  });
  nameInput.addEventListener('input', e => lobbyForm.pendingName = e.target.value);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && nameInput.value.trim()) doCreate();
  });
  setTimeout(() => nameInput.focus(), 50);
  screen.appendChild(nameInput);

  screen.appendChild(el('div', { class: 'spacer-md' }));

  const doCreate = () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('Bitte Namen eingeben.'); return; }
    me.name = name;
    send('create_room', { name });
  };

  screen.appendChild(el('button', { class: 'btn', onclick: doCreate }, 'Raum erstellen'));
  screen.appendChild(el('div', { class: 'spacer-sm' }));
  screen.appendChild(el('button', {
    class: 'btn btn-secondary',
    onclick: () => { lobbyForm.mode = 'choose'; render(); }
  }, 'Zurück'));

  $app.appendChild(screen);
}

function renderHomeJoin() {
  const screen = el('div', { class: 'screen lobby-screen fade-in' });
  screen.appendChild(el('div', { class: 'label-md' }, 'RAUM BEITRETEN'));

  screen.appendChild(el('div', { class: 'spacer-md' }));

  // Code eingeben
  const codeInput = el('input', {
    class: 'input-code',
    type: 'text',
    placeholder: 'CODE',
    maxlength: '4',
    autocomplete: 'off',
    value: lobbyForm.joinCode
  });
  codeInput.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    lobbyForm.joinCode = e.target.value;
  });
  setTimeout(() => codeInput.focus(), 50);
  screen.appendChild(codeInput);

  screen.appendChild(el('div', { class: 'spacer-md' }));

  // Rollen-Auswahl
  const playerCard = el('div', {
    class: `role-card ${lobbyForm.joinAs === 'player' ? 'selected' : ''}`,
    onclick: () => { lobbyForm.joinAs = 'player'; render(); }
  },
    el('div', { class: 'icon' }, '🎮'),
    el('div', { class: 'name' }, 'MITSPIELEN'),
    el('div', { class: 'desc' }, 'nur in Lobby')
  );
  const specCard = el('div', {
    class: `role-card ${lobbyForm.joinAs === 'spectator' ? 'selected' : ''}`,
    onclick: () => { lobbyForm.joinAs = 'spectator'; render(); }
  },
    el('div', { class: 'icon' }, '👁'),
    el('div', { class: 'name' }, 'ZUSCHAUEN'),
    el('div', { class: 'desc' }, 'jederzeit')
  );
  screen.appendChild(el('div', { class: 'role-choice' }, playerCard, specCard));

  screen.appendChild(el('div', { class: 'spacer-md' }));

  // Name
  const nameInput = el('input', {
    class: 'input-text',
    type: 'text',
    placeholder: lobbyForm.joinAs === 'player' ? 'Dein Name' : 'Name (optional)',
    maxlength: '20',
    value: lobbyForm.pendingName
  });
  nameInput.addEventListener('input', e => lobbyForm.pendingName = e.target.value);
  screen.appendChild(nameInput);

  screen.appendChild(el('div', { class: 'spacer-md' }));

  const doJoin = () => {
    const code = codeInput.value.trim();
    const name = nameInput.value.trim();
    if (code.length !== 4) { showToast('Code muss 4 Zeichen haben.'); return; }
    if (lobbyForm.joinAs === 'player' && !name) { showToast('Bitte Namen eingeben.'); return; }
    me.name = name || 'Zuschauer';
    send('join_room', { code, name, as: lobbyForm.joinAs });
  };

  screen.appendChild(el('button', { class: 'btn', onclick: doJoin },
    lobbyForm.joinAs === 'player' ? 'Mitspielen' : 'Zuschauen'));
  screen.appendChild(el('div', { class: 'spacer-sm' }));
  screen.appendChild(el('button', {
    class: 'btn btn-secondary',
    onclick: () => { lobbyForm.mode = 'choose'; render(); }
  }, 'Zurück'));

  $app.appendChild(screen);
}

// ===== Lobby =====
function renderLobby() {
  const screen = el('div', { class: 'screen lobby-screen fade-in' });
  screen.appendChild(el('div', { class: 'label-md' }, 'LOBBY'));
  screen.appendChild(el('h1', { class: 'title' }, 'Warte auf Spieler'));

  screen.appendChild(el('div', { class: 'spacer-md' }));

  const codeBox = el('div', { class: 'code-display', title: 'Klick zum Kopieren' }, serverState.code);
  codeBox.addEventListener('click', () => {
    navigator.clipboard?.writeText(serverState.code);
    showToast('Code kopiert: ' + serverState.code, 'info');
  });
  screen.appendChild(codeBox);

  screen.appendChild(el('div', { class: 'spacer-sm' }));
  screen.appendChild(el('p', { class: 'muted' },
    `${serverState.players.length} / 10 Spieler · ${serverState.spectatorCount} Zuschauer`));

  screen.appendChild(el('div', { class: 'spacer-md' }));

  // Spielerliste
  screen.appendChild(buildPlayerList());

  screen.appendChild(el('div', { class: 'spacer-md' }));

  if (serverState.viewerKind === 'player') {
    const ready = serverState.yourReady;
    const totalPlayers = serverState.players.length;
    const allReady = totalPlayers >= 2 && serverState.players.every(p => p.ready);

    screen.appendChild(el('button', {
      class: 'btn',
      onclick: () => send('set_ready', { ready: !ready })
    }, ready ? 'Bereit ✓ (klick zum Aufheben)' : 'Bereit'));

    screen.appendChild(el('div', { class: 'spacer-sm' }));

    if (totalPlayers < 2) {
      screen.appendChild(el('p', { class: 'muted' }, 'Mindestens 2 Spieler nötig.'));
    } else if (!allReady) {
      const notReady = serverState.players.filter(p => !p.ready).map(p => p.name).join(', ');
      screen.appendChild(el('p', { class: 'muted' }, `Warte auf: ${notReady}`));
    } else {
      screen.appendChild(el('p', { class: 'muted' }, 'Alle bereit — Spiel startet…'));
    }
  } else {
    screen.appendChild(el('p', { class: 'muted' }, 'Du schaust zu. Spiel startet, wenn alle Spieler bereit sind.'));
  }

  screen.appendChild(el('div', { class: 'spacer-md' }));
  screen.appendChild(el('button', {
    class: 'btn btn-secondary',
    onclick: () => leaveRoom()
  }, 'Raum verlassen'));

  $app.appendChild(screen);
}

function buildPlayerList(opts = {}) {
  const list = el('div', { class: 'player-list' });
  list.appendChild(el('h3', null,
    `Spieler (${serverState.players.length})${serverState.spectatorCount ? ` · ${serverState.spectatorCount} 👁` : ''}`));
  for (const p of serverState.players) {
    const isMe = serverState.viewerKind === 'player' && p.id === serverState.yourId;
    const row = el('div', { class: `player-row ${!p.alive ? 'dead' : ''} ${isMe ? 'me' : ''}` },
      el('span', { class: 'name' }, p.name + (isMe ? ' (du)' : '')),
      buildPlayerBadge(p, opts)
    );
    list.appendChild(row);
  }
  return list;
}

function buildPlayerBadge(p, opts) {
  // Verschiedene Badges je nach Phase
  if (!p.alive) return el('span', { class: 'badge dead' }, 'AUS');
  if (!p.connected) return el('span', { class: 'badge disconnected' }, 'OFFLINE');

  if (serverState.phase === 'lobby') {
    return el('span', { class: `badge ${p.ready ? 'ready' : 'waiting'}` },
      p.ready ? 'BEREIT' : 'WARTET');
  }
  if (serverState.phase === 'placing') {
    return el('span', { class: `badge ${p.ready ? 'ready' : 'waiting'}` },
      p.ready ? 'FERTIG' : 'PLATZIERT');
  }
  if (serverState.phase === 'playing') {
    // Steine-Bar zeigen (wie viele am Leben)
    const stones = el('div', { class: 'stones-bar' });
    for (let i = 0; i < SHIPS_PER_PLAYER; i++) {
      stones.appendChild(el('div', {
        class: `stone-dot ${i < p.stonesAlive ? '' : 'dead'}`
      }));
    }
    const wrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
    wrap.appendChild(stones);
    if (p.hasShotThisRound) {
      wrap.appendChild(el('span', { class: 'badge shot' }, '✓'));
    } else {
      wrap.appendChild(el('span', { class: 'badge thinking' }, '…'));
    }
    return wrap;
  }
  if (serverState.phase === 'finished') {
    if (serverState.winner === p.name) return el('span', { class: 'badge ready' }, 'SIEGER');
    return el('span', { class: 'badge dead' }, 'AUS');
  }
  return el('span', null);
}

// ===== Platzierung =====
function renderPlacement() {
  if (serverState.viewerKind === 'spectator') {
    return renderSpectatorWaiting('Spieler platzieren ihre Steine…');
  }

  const screen = el('div', { class: 'screen fade-in' });
  screen.appendChild(buildStatusBar());

  const ready = serverState.yourReady;
  const others = serverState.players.filter(p => p.id !== serverState.yourId);
  const othersReady = others.filter(p => p.ready).length;

  screen.appendChild(el('div', { class: 'label-md' },
    ready ? 'WARTE AUF ANDERE' : `SETZE ${SHIPS_PER_PLAYER} STEINE`));

  screen.appendChild(el('div', { class: 'spacer-sm' }));

  if (ready) {
    screen.appendChild(el('p', { class: 'muted' },
      `${othersReady} / ${others.length} andere Spieler haben platziert.`));
  } else {
    const remaining = SHIPS_PER_PLAYER - localShips.size;
    screen.appendChild(el('p', { class: 'muted' },
      remaining > 0 ? `Noch ${remaining} übrig` : 'Bereit zum Bestätigen'));
  }

  screen.appendChild(el('div', { class: 'spacer-md' }));

  // Board
  const ships = ready ? new Set(serverState.yourShips) : localShips;
  const board = buildOwnBoard(ships, !ready);
  const wrapper = el('div', { class: 'board-wrapper', style: { maxWidth: '540px' } }, board);
  screen.appendChild(wrapper);

  screen.appendChild(el('div', { class: 'spacer-md' }));

  if (!ready) {
    const canConfirm = localShips.size === SHIPS_PER_PLAYER;
    screen.appendChild(el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: '540px' } },
      el('button', {
        class: 'btn btn-secondary',
        style: { maxWidth: '180px' },
        onclick: () => {
          // Zufällig setzen
          localShips.clear();
          while (localShips.size < SHIPS_PER_PLAYER) {
            const r = Math.floor(Math.random() * BOARD_SIZE);
            const c = Math.floor(Math.random() * BOARD_SIZE);
            localShips.add(`${r},${c}`);
          }
          render();
        }
      }, 'Zufällig setzen'),
      el('button', {
        class: 'btn',
        style: { maxWidth: '240px' },
        ...(canConfirm ? {} : { disabled: 'true' }),
        onclick: () => send('set_ships', { ships: Array.from(localShips) })
      }, canConfirm ? 'Bereit' : `${localShips.size} / ${SHIPS_PER_PLAYER}`)
    ));
  }

  $app.appendChild(screen);
}

function buildOwnBoard(ships, interactive) {
  const board = el('div', {
    class: 'board',
    style: { gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }
  });
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const key = `${r},${c}`;
      const isShip = ships.has(key);
      const cell = el('div', {
        class: `cell ${isShip ? 'own-ship' : ''} ${interactive ? '' : 'disabled'}`
      }, isShip ? el('div', { class: 'marker' }) : null);
      if (interactive) {
        cell.addEventListener('click', () => {
          if (localShips.has(key)) localShips.delete(key);
          else if (localShips.size < SHIPS_PER_PLAYER) localShips.add(key);
          render();
        });
      }
      board.appendChild(cell);
    }
  }
  return board;
}

// ===== Spielzustand (playing + finished) =====
function renderGame() {
  const screen = el('div', { class: 'screen fade-in' });

  // Pause-Overlay falls aktiv
  if (serverState.paused) {
    const overlay = el('div', { class: 'pause-overlay' },
      el('div', { class: 'label-md' }, 'PAUSE'),
      el('h1', { class: 'title' }, `${serverState.pausedFor} verbindet neu`),
      el('div', { class: 'countdown' }, fmtTime(serverState.pauseTimeLeft)),
      el('p', { class: 'muted' }, 'Wenn die Verbindung nicht zurückkehrt, scheidet der Spieler aus.')
    );
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 50); // wird im nächsten Render neu gemalt
    // Damit das Overlay bleibt, fügen wir es ans #app an
    document.body.removeChild(overlay);
    $app.appendChild(overlay);
  }

  screen.appendChild(buildStatusBar());

  // Reveal-Banner wenn vorhanden
  if (serverState.lastReveal && serverState.lastReveal.round) {
    screen.appendChild(buildRevealBanner(serverState.lastReveal));
  }

  // Hauptlayout
  const layout = el('div', { class: 'game-layout' });

  // Linke Seite: 2 Boards (eigenes + Angriffsfeld)
  const main = el('div', { class: 'game-main' });
  main.appendChild(buildGameBoards());
  layout.appendChild(main);

  // Rechte Seite: Spielerliste
  const side = el('div', { class: 'game-side' });
  side.appendChild(buildPlayerList());
  if (serverState.phase === 'finished') {
    side.appendChild(el('div', { class: 'spacer-md' }));
    if (serverState.viewerKind === 'player') {
      side.appendChild(el('button', {
        class: 'btn',
        onclick: () => { localShips.clear(); send('play_again'); }
      }, 'Neue Runde'));
      side.appendChild(el('div', { class: 'spacer-sm' }));
    }
    side.appendChild(el('button', {
      class: 'btn btn-secondary',
      onclick: () => leaveRoom()
    }, 'Raum verlassen'));
  }
  layout.appendChild(side);

  screen.appendChild(layout);

  $app.appendChild(screen);
}

function buildStatusBar() {
  const left = el('div', null,
    el('span', { class: 'you-label' },
      serverState.viewerKind === 'spectator' ? '👁 ZUSCHAUER' : `🎮 ${serverState.yourName || ''}`),
    el('span', { style: { color: 'var(--line-strong)' } }, '|'),
    el('span', { class: 'room-code' }, serverState.code)
  );

  const right = el('div', null);

  if (serverState.phase === 'placing') {
    right.appendChild(el('span', { class: 'label-sm' }, 'PLATZIERUNG'));
  } else if (serverState.phase === 'playing') {
    right.appendChild(el('span', { class: 'label-sm' }, `RUNDE ${serverState.roundNumber}`));
    const time = serverState.roundTimeLeft;
    const cd = el('span', { class: `countdown ${time < 10000 ? 'urgent' : ''}` }, fmtTime(time));
    right.appendChild(cd);
  } else if (serverState.phase === 'finished') {
    right.appendChild(el('span', { class: 'label-sm' },
      serverState.winner ? `SIEGER: ${serverState.winner}` : 'UNENTSCHIEDEN'));
  }

  return el('div', { class: 'statusbar' }, left, right);
}

function buildGameBoards() {
  const row = el('div', { class: 'boards-row' });

  // ===== LINKS: Eigenes Feld (nur Spieler) =====
  if (serverState.viewerKind === 'player' && serverState.yourShips) {
    const ownWrap = el('div', { class: 'board-wrapper' });
    const myShipsHit = serverState.yourShipsHit || [];
    const stillAlive = SHIPS_PER_PLAYER - myShipsHit.length;
    ownWrap.appendChild(el('div', { class: 'label-sm' },
      `DEIN FELD  •  ${stillAlive} / ${SHIPS_PER_PLAYER} STEINE`));

    const myShips = new Set(serverState.yourShips);
    const myHit = new Set(myShipsHit);
    const board = el('div', {
      class: 'board',
      style: { gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }
    });
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const key = `${r},${c}`;
        let cls = 'cell disabled';
        let marker = false;
        if (myShips.has(key) && myHit.has(key)) { cls += ' own-hit'; marker = true; }
        else if (myShips.has(key)) { cls += ' own-ship'; marker = true; }
        board.appendChild(el('div', { class: cls },
          marker ? el('div', { class: 'marker' }) : null));
      }
    }
    ownWrap.appendChild(board);
    row.appendChild(ownWrap);
  }

  // ===== RECHTS: Gemeinsames Angriffsfeld =====
  const atkWrap = el('div', { class: 'board-wrapper' });

  let atkLabel;
  if (serverState.phase === 'playing') {
    if (serverState.viewerKind === 'player') {
      atkLabel = serverState.yourShotThisRound
        ? `ANGRIFF  •  Wartet auf andere…`
        : `ANGRIFF  •  Klick ein Feld`;
    } else {
      atkLabel = `ANGRIFF  •  Schüsse werden eingesammelt`;
    }
  } else if (serverState.phase === 'finished') {
    atkLabel = `ANGRIFF  •  Spielende — alle Steine aufgedeckt`;
  } else {
    atkLabel = 'ANGRIFF';
  }
  atkWrap.appendChild(el('div', { class: 'label-sm' }, atkLabel));

  const board = el('div', {
    class: 'board',
    style: { gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }
  });

  // Daten-Sammeln
  const myShot = serverState.yourShotThisRound;
  const reveal = serverState.lastReveal;
  const allHits = new Map(); // cell -> count
  const allMisses = new Set();
  if (reveal && reveal.shots) {
    for (const s of reveal.shots) {
      if (s.hitCount > 0) allHits.set(s.cell, s.hitCount);
      else allMisses.add(s.cell);
    }
  }

  // Bei Spielende: alle Schiffe revealen
  let allShipsCells = null;
  if (serverState.phase === 'finished' && serverState.allShipsRevealed) {
    allShipsCells = new Set();
    for (const player of serverState.allShipsRevealed) {
      for (const s of player.ships) allShipsCells.add(s);
    }
  }

  const isPlayer = serverState.viewerKind === 'player';
  const isPlaying = serverState.phase === 'playing';
  const myAlive = serverState.yourAlive !== false;
  const canShoot = isPlayer && isPlaying && myAlive && !myShot && !serverState.paused;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const key = `${r},${c}`;
      let cls = 'cell';
      let marker = false;
      let multi = null;
      let extraText = null;

      if (allShipsCells && allShipsCells.has(key)) {
        // Spielende: aufgedeckte Schiffe
        cls += ' own-ship'; marker = true;
      }
      if (allHits.has(key)) {
        cls = 'cell hit'; marker = true;
        const count = allHits.get(key);
        if (count > 1) multi = `×${count}`;
      } else if (allMisses.has(key)) {
        cls = 'cell miss'; marker = true;
      }
      if (myShot === key && !allHits.has(key) && !allMisses.has(key)) {
        cls = 'cell my-shot-pending'; marker = true;
      }
      if (!canShoot) cls += ' disabled';

      const cellEl = el('div', { class: cls });
      if (marker) cellEl.appendChild(el('div', { class: 'marker' }));
      if (multi) cellEl.appendChild(el('div', { class: 'multiplier' }, multi));

      if (canShoot) {
        cellEl.addEventListener('click', () => send('shoot', { cell: key }));
      }
      board.appendChild(cellEl);
    }
  }
  atkWrap.appendChild(board);
  row.appendChild(atkWrap);

  return row;
}

function buildRevealBanner(reveal) {
  const banner = el('div', { class: 'reveal-banner' });
  banner.appendChild(el('h3', null, `RUNDE ${reveal.round} — AUFLÖSUNG`));
  const list = el('div', { class: 'reveal-list' });
  if (!reveal.shots || reveal.shots.length === 0) {
    list.appendChild(el('div', { class: 'reveal-item' },
      el('span', { class: 'shooter' }, 'Niemand hat geschossen.')));
  }
  for (const s of (reveal.shots || [])) {
    const item = el('div', { class: 'reveal-item' });
    item.appendChild(el('span', { class: 'shooter' }, s.shooterName));
    item.appendChild(el('span', { class: 'arrow' }, '→'));
    item.appendChild(el('span', { class: 'target-cell' }, s.cell));
    if (s.hitCount > 0) {
      const names = s.hits.map(h => h.playerName).join(', ');
      const t = s.hitCount > 1
        ? `TREFFER ×${s.hitCount} (${names})`
        : `TREFFER (${names})`;
      item.appendChild(el('span', { class: 'result hit' }, t));
    } else {
      item.appendChild(el('span', { class: 'result miss' }, 'DANEBEN'));
    }
    list.appendChild(item);
  }
  banner.appendChild(list);
  if (reveal.eliminations && reveal.eliminations.length > 0) {
    banner.appendChild(el('div', { class: 'elimination-note' },
      `Ausgeschieden: ${reveal.eliminations.join(', ')}`));
  }
  return banner;
}

function renderSpectatorWaiting(text) {
  const screen = el('div', { class: 'screen lobby-screen fade-in' });
  screen.appendChild(buildStatusBar());
  screen.appendChild(el('div', { class: 'spacer-lg' }));
  screen.appendChild(el('div', { class: 'label-md' }, 'ZUSCHAUER-MODUS'));
  screen.appendChild(el('h2', { class: 'subtitle' }, text));
  screen.appendChild(el('div', { class: 'spacer-md' }));
  screen.appendChild(buildPlayerList());
  screen.appendChild(el('div', { class: 'spacer-md' }));
  screen.appendChild(el('button', {
    class: 'btn btn-secondary',
    onclick: () => leaveRoom()
  }, 'Raum verlassen'));
  $app.appendChild(screen);
}

// Start
connect();
render();
