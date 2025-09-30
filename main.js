import { db } from './firebase-config.js';
import { ref, set, onValue, get, update, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const views = document.querySelectorAll('.view');
  const nicknameInput = document.getElementById('nickname-input');
  const hostBtn = document.getElementById('host-btn');
  const joinBtn = document.getElementById('join-btn');
  const displayBtn = document.getElementById('display-btn');

  const roomCodeInput = document.getElementById('room-code-input');
  const joinGameBtn = document.getElementById('join-game-btn');

  const displayRoomCodeInput = document.getElementById('display-room-code-input');
  const joinDisplayBtn = document.getElementById('join-display-btn');

  const startGameBtn = document.getElementById('start-game-btn');
  const nextTurnBtn = document.getElementById('next-turn-btn');

  const externalDisplayCheckbox = document.getElementById('external-display-checkbox');
  const interactionOverlay = document.getElementById('interaction-overlay');
  const interactionContent = document.getElementById('interaction-content');

  // Host settings buttons
  const deckSmallBtn = document.getElementById('deck-small-btn');
  const deckLargeBtn = document.getElementById('deck-large-btn');
  const pyramidRowsInput = document.getElementById('pyramid-rows-input');

  // Locals
  let localPlayer = { nickname: null, isHost: false, isDisplay: false };
  let currentRoomCode = null;
  let unsubscribeGame = null;

  // Helpers
  const showView = (id) => {
    views.forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  };

  async function goBackToMain() {
    // cleanup listeners
    if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }

    if (currentRoomCode) {
      const gameRef = ref(db, `games/${currentRoomCode}`);
      if (localPlayer.isHost) {
        await remove(gameRef);
      } else if (localPlayer.nickname && !localPlayer.isDisplay) {
        await remove(ref(db, `games/${currentRoomCode}/players/${localPlayer.nickname}`));
      } else if (localPlayer.isDisplay) {
        await set(ref(db, `games/${currentRoomCode}/displayJoined`), false);
      }
    }
    localPlayer = { nickname: null, isHost: false, isDisplay: false };
    currentRoomCode = null;
    showView('main-menu-view');
  }

  document.querySelectorAll('.back-btn').forEach(btn => btn.addEventListener('click', goBackToMain));

  // Main menu
  hostBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (!name) return alert('Bitte gib einen Nickname ein.');
    hostNewGame(name);
  });
  joinBtn.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (!name) return alert('Bitte gib einen Nickname ein.');
    localPlayer.nickname = name;
    showView('join-lobby-view');
  });
  displayBtn.addEventListener('click', () => showView('display-join-view'));

  // Lobby actions
  joinGameBtn.addEventListener('click', joinGame);
  joinDisplayBtn.addEventListener('click', joinAsDisplay);

  startGameBtn.addEventListener('click', startGame);
  nextTurnBtn.addEventListener('click', revealNextCard);

  deckSmallBtn.addEventListener('click', () => updateSetting('deck', 'small'));
  deckLargeBtn.addEventListener('click', () => updateSetting('deck', 'large'));
  pyramidRowsInput.addEventListener('change', (e) => updateSetting('rows', Math.max(3, Math.min(7, Number(e.target.value)||5))));
  externalDisplayCheckbox.addEventListener('change', () => updateSetting('useExternalDisplay', externalDisplayCheckbox.checked));

  async function updateSetting(key, value) {
    if (!localPlayer.isHost || !currentRoomCode) return;
    if (key === 'deck') {
      deckSmallBtn.classList.toggle('active', value === 'small');
      deckLargeBtn.classList.toggle('active', value === 'large');
    }
    await update(ref(db, `games/${currentRoomCode}/settings`), { [key]: value });
  }

  // === Game setup ===
  async function hostNewGame(nickname) {
    localPlayer = { nickname, isHost: true, isDisplay: false };
    const code = (Math.floor(1000 + Math.random()*9000)).toString();
    currentRoomCode = code;

    const gameData = {
      state: 'lobby',
      host: nickname,
      settings: { deck: 'small', rows: 5, useExternalDisplay: false },
      players: { [nickname]: { sips: 0, hand: [], receivedCards: [] } },
      displayJoined: false
    };
    const gameRef = ref(db, `games/${code}`);
    await set(gameRef, gameData);
    onDisconnect(gameRef).remove();
    listenToGame(code);
    showView('host-lobby-view');
  }

  async function joinGame() {
    const code = roomCodeInput.value.trim();
    if (!code) return;
    const name = localPlayer.nickname;
    const gameRef = ref(db, `games/${code}`);
    const snap = await get(gameRef);
    if (!snap.exists()) return alert('Spiel nicht gefunden.');

    const game = snap.val();
    if (game.state !== 'lobby') return alert('Spiel hat bereits begonnen.');
    if (Object.keys(game.players||{}).length >= 7) return alert('Das Spiel ist voll.');
    if (game.players && game.players[name]) return alert('Nickname bereits vergeben.');

    currentRoomCode = code;
    const playerRef = ref(db, `games/${code}/players/${name}`);
    await set(playerRef, { sips: 0, hand: [], receivedCards: [] });
    onDisconnect(playerRef).remove();
    listenToGame(code);
    document.getElementById('waiting-area').classList.remove('hidden');
  }

  async function joinAsDisplay() {
    const code = displayRoomCodeInput.value.trim();
    if (!code) return;
    const gameRef = ref(db, `games/${code}`);
    const snap = await get(gameRef);
    if (!snap.exists()) return alert('Spiel nicht gefunden.');
    currentRoomCode = code;
    localPlayer.isDisplay = true;
    await update(gameRef, { displayJoined: true });
    onDisconnect(ref(db, `games/${code}/displayJoined`)).set(false);
    listenToGame(code);
  }

  function listenToGame(code) {
    if (unsubscribeGame) { unsubscribeGame(); }
    const gameRef = ref(db, `games/${code}`);
    unsubscribeGame = onValue(gameRef, (s) => {
      if (!s.exists()) {
        if (!document.getElementById('main-menu-view').classList.contains('active')) alert('Das Spiel wurde beendet.');
        return goBackToMain();
      }
      renderAll(s.val());
    });
  }

  function renderAll(game) {
    if (game.state === 'lobby') {
      renderLobby(game);
      return;
    }
    // playing / finished
    if (!localPlayer.isDisplay && game.players[localPlayer.nickname]) {
      showView('player-game-view');
      renderPlayerView(game);
    } else {
      showView('display-game-view');
      renderDisplayView(game);
    }
  }

  function renderLobby(game) {
    const players = Object.keys(game.players||{});
    const playerCount = players.length;

    if (localPlayer.isHost) {
      showView('host-lobby-view');
      document.getElementById('room-code-display').textContent = currentRoomCode;
      document.getElementById('player-count').textContent = playerCount;
      document.getElementById('player-list-host').innerHTML = players.map(p => `<li>${p} ${p===game.host?'👑':''}</li>`).join('');
      const useDisplay = game.settings.useExternalDisplay;
      externalDisplayCheckbox.checked = !!useDisplay;
      document.getElementById('display-status').classList.toggle('hidden', !useDisplay);
      document.getElementById('display-status').textContent = game.displayJoined ? '✅ Display verbunden.' : '⏳ Wartet auf Display…';
      const canStart = playerCount >= 2 && (!useDisplay || game.displayJoined);
      startGameBtn.disabled = !canStart;
      startGameBtn.textContent = canStart ? 'Spiel starten' : (playerCount < 2 ? 'Warte auf Spieler…' : 'Warte auf Display…');
    } else {
      showView('join-lobby-view');
      document.getElementById('player-list-joiner').innerHTML = players.map(p => `<li>${p} ${p===game.host?'👑':''}</li>`).join('');
    }
  }

  function suitColor(s){ return (s==='♥'||s==='♦') ? 'red' : 'black'; }
  function createCardElement(card, faceDown=false) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.cardId = card.id;
    if (faceDown) {
      el.classList.add('face-down');
    } else {
      el.classList.add(suitColor(card.suit));
      el.innerHTML = `<div class="suit top">${card.suit}</div><span>${card.value}</span><div class="suit bottom">${card.suit}</div>`;
    }
    return el;
  }

  function renderPlayerView(game) {
    const me = game.players[localPlayer.nickname];
    const { turn, pyramid, actionLog, state } = game;

    // hand
    const handEl = document.getElementById('player-hand-container');
    handEl.innerHTML = '';
    me.hand.forEach(card => {
      const c = createCardElement(card);
      if (turn && turn.phase === 'assign') {
        const revealed = pyramid[turn.row][turn.col];
        if (revealed.id === card.id) {
          c.classList.add('can-select');
          c.onclick = () => showPlayerSelection(card, game);
        }
      }
      handEl.appendChild(c);
    });

    // received
    const recEl = document.getElementById('received-cards-container');
    recEl.innerHTML = '';
    (me.receivedCards||[]).forEach(card => recEl.appendChild(createCardElement(card)));
    if (!me.receivedCards || me.receivedCards.length===0) {
      recEl.innerHTML = '<div class="placeholder-text">Hier erscheinen Karten, die du von anderen erhältst.</div>';
    }

    document.getElementById('player-sips').textContent = `Deine Schlücke: ${me.sips||0}`;
    document.getElementById('turn-info').textContent = actionLog || '';

    nextTurnBtn.classList.toggle('hidden', !(localPlayer.isHost && turn && turn.phase==='reveal'));
    if (state==='finished') nextTurnBtn.classList.add('hidden');
  }

  function renderDisplayView(game) {
    const { players, pyramid, actionLog, state } = game;
    // top players list
    const playersWrap = document.getElementById('display-players-container');
    playersWrap.innerHTML='';
    Object.entries(players).forEach(([name, data]) => {
      const d = document.createElement('div');
      d.className = 'player-display selectable';
      d.innerHTML = `<div>${name}</div><div>Schlücke: ${data.sips||0}</div>`;
      d.onclick = () => showPlayerCards(name, data);
      playersWrap.appendChild(d);
    });

    // pyramid
    const pyrEl = document.getElementById('pyramid-container');
    pyrEl.innerHTML = '';
    (pyramid||[]).forEach(row => {
      const rowEl = document.createElement('div'); rowEl.className='pyramid-row';
      row.forEach(card => rowEl.appendChild(createCardElement(card, !card.revealed)));
      pyrEl.appendChild(rowEl);
    });

    const log = document.getElementById('action-log');
    log.textContent = actionLog || '';
    if (state==='finished') { log.style.color='var(--success)'; }
  }

  function showPlayerCards(name, data) {
    interactionOverlay.classList.remove('hidden');
    const cards = (data.receivedCards||[]).map(c => createCardElement(c).outerHTML).join('') || '<div class="placeholder-text">Keine erhaltenen Karten.</div>';
    interactionContent.innerHTML = \`
      <h3>${name} – erhaltene Karten</h3>
      <div class="hand-container">\${cards}</div>
      <button id="close-overlay">Schließen</button>
    \`;
    document.getElementById('close-overlay').onclick = () => interactionOverlay.classList.add('hidden');
  }

  function showPlayerSelection(card, game) {
    interactionOverlay.classList.remove('hidden');
    const others = Object.keys(game.players).filter(p => p !== localPlayer.nickname);
    const btns = others.map(p => \`<button class="player-select-btn" data-player="\${p}">\${p}</button>\`).join('');
    interactionContent.innerHTML = \`
      <h3>Wem gibst du einen Schluck?</h3>
      <div class="player-selection-grid">\${btns}</div>
      <button id="cancel-selection">Abbrechen</button>
    \`;
    document.querySelectorAll('.player-select-btn').forEach(b => b.onclick = () => assignSip(card, b.dataset.player));
    document.getElementById('cancel-selection').onclick = () => interactionOverlay.classList.add('hidden');
  }

  async function startGame() {
    const gameRef = ref(db, \`games/\${currentRoomCode}\`);
    const snap = await get(gameRef);
    const game = snap.val();
    const { settings, players } = game;
    const names = Object.keys(players);

    // build deck
    const suits = ['♥','♦','♣','♠'];
    const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    let deck = [];
    for (const s of suits) for (const v of values) deck.push({ value:v, suit:s, id:\`\${v}\${s}\` });
    if (settings.deck === 'small') deck = deck.filter(c => !['2','3','4','5','6'].includes(c.value));
    deck.sort(() => Math.random() - 0.5);

    const updatedPlayers = { ...players };
    for (const n of names) {
      updatedPlayers[n].hand = deck.splice(0,4);
      updatedPlayers[n].receivedCards = [];
      updatedPlayers[n].sips = 0;
    }

    // pyramid
    const pyramid = [];
    for (let r=0;r<settings.rows;r++){
      const row=[];
      for(let c=0;c<=r;c++){
        if(!deck.length){ alert('Deck zu klein für diese Pyramide!'); return; }
        row.push({ ...deck.splice(0,1)[0], revealed:false });
      }
      pyramid.push(row);
    }

    await update(gameRef, {
      state:'playing',
      players:updatedPlayers,
      pyramid,
      turn:{ row:0, col:0, phase:'reveal' },
      actionLog:\`Spiel gestartet! \${game.host} deckt die erste Karte auf.\`
    });
  }

  async function revealNextCard() {
    const gameRef = ref(db, \`games/\${currentRoomCode}\`);
    const game = (await get(gameRef)).val();
    const { turn, pyramid, players } = game;
    const revealed = pyramid[turn.row][turn.col];

    // mark revealed & switch to assign
    await update(gameRef, {
      ['/pyramid/'+turn.row+'/'+turn.col+'/revealed']: true,
      ['/turn/phase']: 'assign',
      ['/actionLog']: \`Karte \${revealed.value}\${revealed.suit} aufgedeckt. Spieler mit dieser Karte in der Hand dürfen Schlücke verteilen.\`
    });

    // if any player already has this card in RECEIVED cards -> they drink 1 (auto)
    const receivers = Object.entries(players).filter(([_,p]) => (p.receivedCards||[]).some(c => c.id===revealed.id)).map(([n])=>n);
    if (receivers.length){
      const upd = {};
      receivers.forEach(name => {
        const cur = players[name].sips||0;
        upd['/players/'+name+'/sips'] = cur + 1; // 1 Schluck wie in Beispiel
      });
      upd['/actionLog'] = \`🔔 \${receivers.join(', ')} muss/müssen 1 Schluck trinken (Karte zuvor erhalten).\`;
      await update(gameRef, upd);
    }

    // if nobody has the revealed card in HAND -> auto-advance after 2.5s
    const someoneCanAssign = Object.values(players).some(p => (p.hand||[]).some(c => c.id===revealed.id));
    if (!someoneCanAssign) {
      setTimeout(goToNextStepAfterAssign, 2500);
    }
  }

  async function assignSip(card, targetName) {
    interactionOverlay.classList.add('hidden');
    const gameRef = ref(db, \`games/\${currentRoomCode}\`);
    const game = (await get(gameRef)).val();
    const target = game.players[targetName];

    const updates = {};
    updates['/players/'+targetName+'/sips'] = (target.sips||0) + 1; // 1 Schluck beim Geben
    const newReceived = [ ...(target.receivedCards||[]), card ];
    updates['/players/'+targetName+'/receivedCards'] = newReceived;
    updates['/actionLog'] = \`🍺 \${localPlayer.nickname} hat \${targetName} 1 Schluck gegeben.\`;

    await update(gameRef, updates);
    await goToNextStepAfterAssign();
  }

  async function goToNextStepAfterAssign() {
    const gameRef = ref(db, \`games/\${currentRoomCode}\`);
    const game = (await get(gameRef)).val();
    let { row, col } = game.turn;

    // move pointer
    col++;
    if (col >= game.pyramid[row].length) { col=0; row++; }

    const upd = {};
    if (row >= game.pyramid.length) {
      upd['/state'] = 'finished';
      upd['/actionLog'] = '🎉 Pyramide komplett aufgedeckt! Spiel beendet. Prost!';
    } else {
      upd['/turn/row'] = row;
      upd['/turn/col'] = col;
      upd['/turn/phase'] = 'reveal';
      upd['/actionLog'] = \`\${game.host} ist dran, die nächste Karte aufzudecken.\`;
    }
    await update(gameRef, upd);
  }
});
