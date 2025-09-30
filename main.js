import { db } from './firebase-config.js';
import { ref, set, onValue, get, update, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

// Wir warten, bis das gesamte HTML geladen ist, bevor wir unser Skript ausführen.
// Das verhindert Fehler, bei denen auf nicht existierende Elemente zugegriffen wird.
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM-Elemente ---
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

    // --- Lokaler Spielzustand ---
    let localPlayer = { nickname: null, isHost: false };
    let currentRoomCode = null;
    /** @type {(() => void) | null} */
    let gameUnsubscribe = null;

    // --- UI-Navigation ---
    function showView(viewId) {
        views.forEach(view => view.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
    }

    // --- ZURÜCK-BUTTON LOGIK (Robust) ---
    async function goBackToMain() {
        if (gameUnsubscribe) {
            gameUnsubscribe();
            gameUnsubscribe = null;
        }

        if (currentRoomCode) {
            const gameRef = ref(db, `games/${currentRoomCode}`);
            if (localPlayer.isHost) {
                // Host geht zurück -> löscht das gesamte Spiel für alle.
                await remove(gameRef);
            } else if (localPlayer.nickname) {
                // Joiner geht zurück -> entfernt nur sich selbst aus dem Spiel.
                const playerRef = ref(db, `games/${currentRoomCode}/players/${localPlayer.nickname}`);
                await remove(playerRef);
            }
        }
        
        // Lokalen Zustand komplett zurücksetzen
        localPlayer = { nickname: null, isHost: false };
        currentRoomCode = null;
        showView('main-menu-view');
    }

    // --- Event Listener Initialisierung ---
    
    // Hauptmenü
    hostBtn.addEventListener('click', () => {
        const nickname = nicknameInput.value.trim();
        if (!nickname) {
            alert('Bitte gib einen Nickname ein.');
            return;
        }
        hostNewGame(nickname);
    });

    joinBtn.addEventListener('click', () => {
        const nickname = nicknameInput.value.trim();
        if (!nickname) {
            alert('Bitte gib einen Nickname ein.');
            return;
        }
        localPlayer.nickname = nickname;
        showView('join-lobby-view');
    });

    displayBtn.addEventListener('click', () => showView('display-join-view'));

    // Lobbies
    joinGameBtn.addEventListener('click', joinGame);
    joinDisplayBtn.addEventListener('click', joinAsDisplay);
    document.querySelectorAll('.back-btn').forEach(btn => btn.addEventListener('click', goBackToMain));

    // Host-spezifische Aktionen
    startGameBtn.addEventListener('click', startGame);
    nextTurnBtn.addEventListener('click', revealNextCard);
    externalDisplayCheckbox.addEventListener('change', () => updateSetting('useExternalDisplay', externalDisplayCheckbox.checked));
    document.getElementById('deck-small-btn').addEventListener('click', () => updateSetting('deck', 'small'));
    document.getElementById('deck-large-btn').addEventListener('click', () => updateSetting('deck', 'large'));
    document.getElementById('pyramid-rows-input').addEventListener('change', (e) => updateSetting('rows', parseInt(e.target.value)));

    async function updateSetting(key, value) {
        if (!localPlayer.isHost || !currentRoomCode) return;
        if (key === 'deck') {
            document.getElementById('deck-small-btn').classList.toggle('active', value === 'small');
            document.getElementById('deck-large-btn').classList.toggle('active', value === 'large');
        }
        await update(ref(db, `games/${currentRoomCode}/settings`), { [key]: value });
    }

    // --- SPIEL-SETUP FUNKTIONEN ---

    async function hostNewGame(nickname) {
        localPlayer = { nickname, isHost: true };
        currentRoomCode = Math.floor(1000 + Math.random() * 9000).toString();
        
        const gameData = {
            state: 'lobby',
            host: nickname,
            settings: { deck: 'small', rows: 5, useExternalDisplay: false },
            players: { [nickname]: { sips: 0, hand: [], receivedCards: [] } },
            displayJoined: false
        };

        const gameRef = ref(db, `games/${currentRoomCode}`);
        await set(gameRef, gameData);
        onDisconnect(gameRef).remove();
        listenToGameUpdates(currentRoomCode);
        showView('host-lobby-view');
    }

    async function joinGame() {
        const roomCode = roomCodeInput.value.trim();
        if (!localPlayer.nickname || !roomCode) return;

        const gameRef = ref(db, `games/${roomCode}`);
        const snapshot = await get(gameRef);

        if (snapshot.exists()) {
            const gameData = snapshot.val();
            if (Object.keys(gameData.players).length >= 7) { alert("Dieses Spiel ist bereits voll."); return; }
            if (gameData.players[localPlayer.nickname]) { alert("Dieser Nickname ist bereits vergeben."); return; }
            if (gameData.state !== 'lobby') { alert("Dieses Spiel hat bereits begonnen."); return; }
            
            currentRoomCode = roomCode;
            const playerRef = ref(db, `games/${roomCode}/players/${localPlayer.nickname}`);
            await set(playerRef, { sips: 0, hand: [], receivedCards: [] });
            onDisconnect(playerRef).remove();
            listenToGameUpdates(roomCode);
            document.getElementById('waiting-area').classList.remove('hidden');
        } else {
            alert('Spiel mit diesem Code nicht gefunden.');
        }
    }
    
    async function joinAsDisplay() {
        const roomCode = displayRoomCodeInput.value.trim();
        if (!roomCode) return;
    
        const gameRef = ref(db, `games/${roomCode}`);
        const snapshot = await get(gameRef);
        if (snapshot.exists()) {
            currentRoomCode = roomCode;
            await update(gameRef, { displayJoined: true });
            onDisconnect(ref(db, `games/${roomCode}/displayJoined`)).set(false);
            listenToGameUpdates(roomCode);
        } else {
            alert('Spiel mit diesem Code nicht gefunden.');
        }
    }
    
    function listenToGameUpdates(roomCode) {
        if (gameUnsubscribe) gameUnsubscribe();
        const gameRef = ref(db, `games/${roomCode}`);
        gameUnsubscribe = onValue(gameRef, (snapshot) => {
            if (!snapshot.exists()) {
                if (document.getElementById('main-menu-view').classList.contains('active')) return;
                alert("Das Spiel wurde vom Host beendet.");
                goBackToMain();
                return;
            }
            const gameData = snapshot.val();
            renderUI(gameData);
        });
    }
    
    function renderUI(gameData) {
        if (gameData.state === 'lobby') {
            renderLobby(gameData);
        } else if (gameData.state === 'playing' || gameData.state === 'finished') {
            if (gameData.players[localPlayer.nickname]) {
                showView('player-game-view');
                renderPlayerView(gameData);
            } else {
                showView('display-game-view');
                renderDisplayView(gameData);
            }
        }
    }
    
    function renderLobby(gameData) {
        const players = Object.keys(gameData.players);
        const playerCount = players.length;
    
        if (localPlayer.isHost) {
            showView('host-lobby-view');
            document.getElementById('room-code-display').textContent = currentRoomCode;
            document.getElementById('player-list-host').innerHTML = players.map(p => `<li>${p} ${p === gameData.host ? '👑' : ''}</li>`).join('');
            document.getElementById('player-count').textContent = playerCount;
            
            const useDisplay = gameData.settings.useExternalDisplay;
            document.getElementById('display-status').classList.toggle('hidden', !useDisplay);
            document.getElementById('display-status').textContent = gameData.displayJoined ? '✅ Display beigetreten.' : '⏳ Wartet auf Display...';
            
            const canStart = playerCount >= 2 && (!useDisplay || gameData.displayJoined);
            startGameBtn.disabled = !canStart;
            startGameBtn.textContent = canStart ? 'Spiel starten' : (playerCount < 2 ? 'Warte auf Spieler...' : 'Warte auf Display...');
        } else if (localPlayer.nickname) {
            showView('join-lobby-view');
            document.getElementById('player-list-joiner').innerHTML = players.map(p => `<li>${p} ${p === gameData.host ? '👑' : ''}</li>`).join('');
        }
    }
    
    function renderPlayerView(gameData) {
        const myData = gameData.players[localPlayer.nickname];
        const { turn, pyramid, actionLog, state } = gameData;
    
        const handContainer = document.getElementById('player-hand-container');
        handContainer.innerHTML = '';
        myData.hand.forEach(card => {
            const cardEl = createCardElement(card);
            if (turn && turn.phase === 'assign') {
                const revealedCard = pyramid[turn.row][turn.col];
                if (revealedCard.id === card.id) {
                    cardEl.classList.add('can-select');
                    cardEl.onclick = () => showPlayerSelection(card, gameData);
                }
            }
            handContainer.appendChild(cardEl);
        });
    
        const receivedContainer = document.getElementById('received-cards-container');
        receivedContainer.innerHTML = '';
        (myData.receivedCards || []).forEach(card => receivedContainer.appendChild(createCardElement(card)));
        if (!myData.receivedCards || myData.receivedCards.length === 0) {
            receivedContainer.innerHTML = `<div class="placeholder-text">Hier erscheinen Karten, die du von anderen erhältst.</div>`;
        }
    
        document.getElementById('player-sips').textContent = `Deine Schlücke: ${myData.sips}`;
        document.getElementById('turn-info').textContent = actionLog;
        
        nextTurnBtn.classList.toggle('hidden', !(localPlayer.isHost && turn && turn.phase === 'reveal'));
        if (state === 'finished') {
            nextTurnBtn.classList.add('hidden');
        }
    }
    
    function renderDisplayView(gameData) {
        const { players, pyramid, actionLog, state } = gameData;
    
        const playersContainer = document.getElementById('display-players-container');
        playersContainer.innerHTML = '';
        Object.entries(players).forEach(([name, data]) => {
            const playerEl = document.createElement('div');
            playerEl.className = 'player-display';
            playerEl.innerHTML = `<div>${name}</div><div>Schlücke: ${data.sips}</div>`;
            playersContainer.appendChild(playerEl);
        });
    
        const pyramidContainer = document.getElementById('pyramid-container');
        pyramidContainer.innerHTML = '';
        pyramid.forEach(row => {
            const rowEl = document.createElement('div');
            rowEl.className = 'pyramid-row';
            row.forEach(card => rowEl.appendChild(createCardElement(card, !card.revealed)));
            pyramidContainer.appendChild(rowEl);
        });
    
        document.getElementById('action-log').textContent = actionLog;
        if (state === 'finished') {
            document.getElementById('action-log').style.color = 'var(--success-color)';
        }
    }
    
    function createCardElement(card, isFaceDown = false) {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        if (isFaceDown) {
            cardEl.classList.add('face-down');
        } else {
            const color = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
            cardEl.classList.add(color);
            cardEl.innerHTML = `
                <div class="suit top">${card.suit}</div>
                <span>${card.value}</span>
                <div class="suit bottom">${card.suit}</div>
            `;
        }
        cardEl.dataset.cardId = card.id;
        return cardEl;
    }
    
    async function startGame() {
        const gameRef = ref(db, `games/${currentRoomCode}`);
        const snapshot = await get(gameRef);
        const gameData = snapshot.val();
        const { settings, players } = gameData;
        const playerNames = Object.keys(players);
    
        const suits = ['♥', '♦', '♣', '♠'];
        const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        let deck = [];
        for (const suit of suits) {
            for (const value of values) {
                deck.push({ value, suit, id: `${value}${suit}` });
            }
        }
        if (settings.deck === 'small') deck = deck.filter(c => !['2','3','4','5','6'].includes(c.value));
        deck.sort(() => Math.random() - 0.5);
    
        const updatedPlayers = { ...players };
        for (const name of playerNames) {
            updatedPlayers[name].hand = deck.splice(0, 4);
            updatedPlayers[name].receivedCards = [];
            updatedPlayers[name].sips = 0;
        }
    
        const pyramid = [];
        for (let i = 0; i < settings.rows; i++) {
            const row = [];
            for (let j = 0; j <= i; j++) {
                if (deck.length === 0) { alert("Deck zu klein für diese Pyramide!"); return; }
                row.push({ ...deck.splice(0, 1)[0], revealed: false });
            }
            pyramid.push(row);
        }
    
        const gameUpdate = {
            state: 'playing',
            players: updatedPlayers,
            pyramid,
            turn: { row: 0, col: 0, phase: 'reveal' },
            actionLog: `Spiel gestartet! ${gameData.host} deckt die erste Karte auf.`
        };
    
        await update(gameRef, gameUpdate);
    }
    
    async function revealNextCard() {
        const gameRef = ref(db, `games/${currentRoomCode}`);
        const gameData = await get(gameRef).then(s => s.val());
        const { turn, pyramid } = gameData;
    
        const updates = {};
        updates[`/pyramid/${turn.row}/${turn.col}/revealed`] = true;
        updates['/turn/phase'] = 'assign';
        const revealedCard = pyramid[turn.row][turn.col];
        updates['/actionLog'] = `Karte ${revealedCard.value}${revealedCard.suit} aufgedeckt. Spieler mit dieser Karte können jetzt Schlücke verteilen.`;
        
        await update(gameRef, updates);
    
        const playersWithCard = Object.values(gameData.players).some(p => p.hand.some(c => c.id === revealedCard.id));
        if (!playersWithCard) {
            setTimeout(goToNextRevealPhase, 3000);
        }
    }
    
    function showPlayerSelection(card, gameData) {
        interactionOverlay.classList.remove('hidden');
        const otherPlayers = Object.keys(gameData.players).filter(p => p !== localPlayer.nickname);
        
        let buttonsHTML = otherPlayers.map(p => `<button class="player-select-btn" data-player="${p}">${p}</button>`).join('');
        
        interactionContent.innerHTML = `
            <h3>Wem gibst du einen Schluck?</h3>
            <div class="player-selection-grid">${buttonsHTML}</div>
            <button id="cancel-selection">Abbrechen</button>
        `;
    
        document.querySelectorAll('.player-select-btn').forEach(btn => {
            btn.onclick = () => assignSip(card, btn.dataset.player);
        });
        document.getElementById('cancel-selection').onclick = () => interactionOverlay.classList.add('hidden');
    }
    
    async function assignSip(card, targetPlayerName) {
        interactionOverlay.classList.add('hidden');
        
        const gameRef = ref(db, `games/${currentRoomCode}`);
        const gameData = await get(gameRef).then(s => s.val());
    
        const sipsToGive = gameData.turn.row + 1;
        const targetPlayerData = gameData.players[targetPlayerName];
    
        const updates = {};
        updates[`/players/${targetPlayerName}/sips`] = (targetPlayerData.sips || 0) + sipsToGive;
        const newReceivedCards = [...(targetPlayerData.receivedCards || []), card];
        updates[`/players/${targetPlayerName}/receivedCards`] = newReceivedCards;
        updates['/actionLog'] = `🍺 ${localPlayer.nickname} hat ${targetPlayerName} ${sipsToGive} Schluck(e) gegeben.`;
        
        await update(gameRef, updates);
        await goToNextRevealPhase();
    }
    
    async function goToNextRevealPhase() {
        const gameRef = ref(db, `games/${currentRoomCode}`);
        const gameData = await get(gameRef).then(s => s.val());
        let { row, col } = gameData.turn;
    
        col++;
        if (col >= gameData.pyramid[row].length) {
            col = 0;
            row++;
        }
    
        const updates = {};
        if (row >= gameData.pyramid.length) {
            updates['/state'] = 'finished';
            updates['/actionLog'] = '🎉 Pyramide komplett aufgedeckt! Spiel beendet. Prost!';
        } else {
            updates['/turn/row'] = row;
            updates['/turn/col'] = col;
            updates['/turn/phase'] = 'reveal';
            updates['/actionLog'] = `${gameData.host} ist dran, die nächste Karte aufzudecken.`;
        }
        await update(gameRef, updates);
    }

}); // Ende des DOMContentLoaded Listeners
