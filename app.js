import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, deleteDoc, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const REVEAL_MS = 3500;
const BASE_POINTS = 100;
const SPEED_POINTS = 100;
const FIRST_BONUS = 50;

const $ = (id) => document.getElementById(id);

const reactionLayer = document.createElement('div');
reactionLayer.className = 'reaction-layer';
document.body.appendChild(reactionLayer);

const state = {
  db: null,
  code: null,
  pid: null,
  isHost: false,
  unsub: null,
  room: null,
  roundKey: null,     // `${current}:${phase}` — detects a genuinely new phase
  localStart: 0,      // performance.now() when this round's question appeared
  answered: false,
  tickHandle: null,
  hostHandle: null,
  hostBusy: false,
};

// Firestore field paths reject segments that start with a digit or contain
// hyphens, so player ids and round keys are plain alphanumerics.
const newId = () => Array.from({ length: 16 }, () =>
  'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
const roundKeyFor = (n) => `r${n}`;

/* ---------------- screens ---------------- */

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

/* ---------------- boot ---------------- */

if (firebaseConfig.apiKey === 'PASTE_ME') {
  show('config');
} else {
  state.db = getFirestore(initializeApp(firebaseConfig));
  wireUp();
  const preset = new URLSearchParams(location.search).get('room');
  if (preset) $('input-code').value = preset.toUpperCase().slice(0, 4);
  $('input-name').value = localStorage.getItem('dtr:name') || '';
}

/* ---------------- setup screen ---------------- */

function wireUp() {
  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', joinRoom);
  $('btn-start').addEventListener('click', startGame);
  $('btn-leave').addEventListener('click', leaveRoom);
  $('btn-copy').addEventListener('click', copyInvite);
  $('btn-again').addEventListener('click', playAgain);
  $('btn-home').addEventListener('click', leaveRoom);
  $('input-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('input-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoom(); });
}

function readName() {
  const name = $('input-name').value.trim();
  if (!name) { setError('Enter your name first.'); return null; }
  localStorage.setItem('dtr:name', name);
  return name;
}

function setError(msg) {
  const el = $('setup-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

async function createRoom() {
  setError('');
  const name = readName();
  if (!name) return;

  state.pid = newId();
  state.isHost = true;

  let code;
  for (let i = 0; i < 5; i++) {
    const candidate = newCode();
    const snap = await getDoc(doc(state.db, 'rooms', candidate));
    if (!snap.exists()) { code = candidate; break; }
  }
  if (!code) { setError('Could not create a room. Try again.'); return; }

  await setDoc(doc(state.db, 'rooms', code), {
    hostId: state.pid,
    status: 'lobby',
    phase: 'question',
    current: -1,
    order: [],
    settings: readSettings(),
    players: { [state.pid]: { name, score: 0, order: 0 } },
    answers: {},
    createdAt: Date.now(),
  });

  listen(code);
}

function readSettings() {
  return {
    rounds: Number($('input-rounds').value),
    timer: Number($('input-timer').value),
    cat: $('input-cat').value,
  };
}

async function joinRoom() {
  setError('');
  const name = readName();
  if (!name) return;

  const code = $('input-code').value.trim().toUpperCase();
  if (code.length !== 4) { setError('Room codes are 4 characters.'); return; }

  const ref = doc(state.db, 'rooms', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) { setError(`No room called ${code}.`); return; }

  const room = snap.data();
  if (Object.keys(room.players).length >= 2) { setError('That room is already full.'); return; }
  if (room.status !== 'lobby') { setError('That game has already started.'); return; }

  state.pid = newId();
  state.isHost = false;
  await updateDoc(ref, {
    [`players.${state.pid}`]: { name, score: 0, order: 1 },
  });

  listen(code);
}

/* ---------------- realtime ---------------- */

function listen(code) {
  state.code = code;
  if (state.unsub) state.unsub();
  state.unsub = onSnapshot(doc(state.db, 'rooms', code), (snap) => {
    if (!snap.exists()) { exitToSetup(); return; }
    state.room = snap.data();
    render();
  });
  if (state.isHost) {
    clearInterval(state.hostHandle);
    state.hostHandle = setInterval(hostTick, 400);
  }
}

function render() {
  const room = state.room;
  if (room.status === 'lobby') { renderLobby(); return; }
  if (room.status === 'finished') { renderResults(); return; }
  renderGame();
}

/* ---------------- lobby ---------------- */

function renderLobby() {
  show('lobby');
  $('lobby-code').textContent = state.code;

  const list = playerList();
  $('lobby-players').innerHTML = list.map(playerRow).join('');

  const ready = list.length === 2;
  $('lobby-status').textContent = ready
    ? (state.isHost ? 'Both in. Start whenever you\'re ready.' : 'Waiting for the host to start…')
    : 'Waiting for your partner to join…';

  const btn = $('btn-start');
  btn.hidden = !state.isHost;
  btn.disabled = !ready;
}

function playerList() {
  return Object.entries(state.room.players)
    .map(([pid, p]) => ({ pid, ...p }))
    .sort((a, b) => a.order - b.order);
}

function playerRow(p) {
  const me = p.pid === state.pid ? ' me' : '';
  return `<div class="player${me}">
    <span class="who"><span class="dot"></span>${escapeHtml(p.name)}${me ? ' (you)' : ''}</span>
    <span class="pts">${p.score}</span>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function copyInvite() {
  const url = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    await navigator.clipboard.writeText(url);
    $('btn-copy').textContent = 'Copied!';
    setTimeout(() => { $('btn-copy').textContent = 'Copy invite link'; }, 1600);
  } catch {
    prompt('Copy this link:', url);
  }
}

/* ---------------- starting ---------------- */

async function startGame() {
  const settings = readSettings();
  const pool = QUESTIONS
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => settings.cat === 'all' || q.cat === settings.cat);

  const order = shuffle(pool.map(({ i }) => i)).slice(0, settings.rounds);

  await updateDoc(doc(state.db, 'rooms', state.code), {
    status: 'playing',
    phase: 'question',
    current: 0,
    order,
    settings,
    answers: {},
    startedAt: Date.now(),
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- game screen ---------------- */

function renderGame() {
  show('game');
  const room = state.room;
  const key = `${room.current}:${room.phase}`;

  $('game-scores').innerHTML = playerList().map(playerRow).join('');

  if (key !== state.roundKey) {
    state.roundKey = key;
    if (room.phase === 'question') {
      state.localStart = performance.now();
      state.answered = false;
      paintQuestion();
      startTicker();
    } else {
      stopTicker();
      paintReveal();
    }
  } else if (room.phase === 'question') {
    markOpponentAnswered();
  }
}

function currentQuestion() {
  return QUESTIONS[state.room.order[state.room.current]];
}

function paintQuestion() {
  clearReactionLayer();
  const room = state.room;
  const q = currentQuestion();

  $('q-counter').textContent = `Q${room.current + 1} of ${room.order.length}`;
  $('q-cat').textContent = q.cat;
  $('q-text').textContent = q.q;
  $('q-feedback').textContent = '';
  $('q-feedback').className = 'feedback';

  $('q-options').innerHTML = q.options.map((opt, i) => `
    <button class="opt" data-i="${i}">
      <span class="key">${'ABCD'[i]}</span>
      <span>${escapeHtml(opt)}</span>
    </button>`).join('');

  $('q-options').querySelectorAll('.opt').forEach((btn) => {
    btn.addEventListener('click', () => submitAnswer(Number(btn.dataset.i)));
  });
}

function clearReactionLayer() {
  reactionLayer.innerHTML = '';
}

function emitReaction(kind) {
  clearReactionLayer();
  const count = kind === 'love' ? 18 : 12;
  const fragment = document.createDocumentFragment();

  if (kind === 'love') {
    for (let i = 0; i < count; i++) {
      const heart = document.createElement('span');
      heart.className = 'reaction reaction-love';
      heart.textContent = '❤';
      heart.style.left = `${18 + Math.random() * 64}%`;
      heart.style.setProperty('--dx', `${(Math.random() - 0.5) * 120}px`);
      heart.style.setProperty('--dy', `${Math.random() * 80 + 10}px`);
      heart.style.setProperty('--dx2', `${(Math.random() - 0.5) * 170}px`);
      heart.style.fontSize = `${14 + Math.random() * 20}px`;
      heart.style.animationDelay = `${i * 0.04}s`;
      fragment.appendChild(heart);
    }
  } else {
    const splash = document.createElement('span');
    splash.className = 'reaction reaction-water';
    fragment.appendChild(splash);

    for (let i = 0; i < count; i++) {
      const tear = document.createElement('span');
      tear.className = 'reaction reaction-tear';
      tear.textContent = Math.random() > 0.5 ? '😢' : '😭';
      tear.style.left = `${18 + Math.random() * 64}%`;
      tear.style.setProperty('--drift', `${(Math.random() - 0.5) * 90}px`);
      tear.style.animationDelay = `${i * 0.06}s`;
      fragment.appendChild(tear);
    }
  }

  reactionLayer.appendChild(fragment);
  window.setTimeout(clearReactionLayer, kind === 'love' ? 1800 : 2200);
}

async function submitAnswer(choice) {
  if (state.answered) return;
  state.answered = true;

  const ms = Math.round(performance.now() - state.localStart);
  const correct = choice === currentQuestion().answer;

  $('q-options').querySelectorAll('.opt').forEach((btn, i) => {
    btn.disabled = true;
    if (i === choice) btn.classList.add('picked');
  });
  $('q-feedback').textContent = 'Locked in. Waiting…';

  await updateDoc(doc(state.db, 'rooms', state.code), {
    [`answers.${roundKeyFor(state.room.current)}.${state.pid}`]: { choice, ms, correct },
  });
}

function markOpponentAnswered() {
  if (state.answered) return;
  const answers = state.room.answers?.[roundKeyFor(state.room.current)] || {};
  const others = Object.keys(answers).filter((pid) => pid !== state.pid);
  if (others.length) $('q-feedback').textContent = 'Your partner has answered!';
}

function paintReveal() {
  const room = state.room;
  const q = currentQuestion();
  const answers = room.answers?.[roundKeyFor(room.current)] || {};
  const mine = answers[state.pid];

  $('q-options').querySelectorAll('.opt').forEach((btn, i) => {
    btn.disabled = true;
    btn.classList.remove('picked');
    if (i === q.answer) btn.classList.add('correct');
    else if (mine && i === mine.choice) btn.classList.add('wrong');
  });

  const fb = $('q-feedback');
  if (!mine) {
    fb.textContent = 'Out of time!';
    fb.className = 'feedback bad';
    emitReaction('sad');
  } else if (mine.correct) {
    const others = Object.entries(answers).filter(([pid]) => pid !== state.pid);
    const beatThem = others.every(([, a]) => !a.correct || a.ms > mine.ms);
    fb.textContent = beatThem ? `Correct — and fastest! (${(mine.ms / 1000).toFixed(1)}s)` : `Correct! (${(mine.ms / 1000).toFixed(1)}s)`;
    fb.className = 'feedback good';
    emitReaction('love');
  } else {
    fb.textContent = 'Not quite.';
    fb.className = 'feedback bad';
    emitReaction('sad');
  }

  $('timer-fill').style.transform = 'scaleX(0)';
}

/* ---------------- countdown ---------------- */

function startTicker() {
  stopTicker();
  const total = state.room.settings.timer * 1000;
  state.tickHandle = setInterval(() => {
    const left = Math.max(0, 1 - (performance.now() - state.localStart) / total);
    $('timer-fill').style.transform = `scaleX(${left})`;
    if (left === 0) stopTicker();
  }, 60);
}

function stopTicker() {
  clearInterval(state.tickHandle);
  state.tickHandle = null;
}

/* ---------------- host authority ---------------- */

async function hostTick() {
  const room = state.room;
  // hostBusy holds until the write lands back as a snapshot, so a slow round
  // transition is not applied twice by the next tick.
  if (state.hostBusy || !room || room.status !== 'playing') return;

  const ref = doc(state.db, 'rooms', state.code);
  const answers = room.answers?.[roundKeyFor(room.current)] || {};
  const pids = Object.keys(room.players);

  try {
    if (room.phase === 'question') {
      const everyone = pids.every((pid) => answers[pid]);
      const expired = performance.now() - state.localStart > room.settings.timer * 1000;
      if (!everyone && !expired) return;

      state.hostBusy = true;
      await updateDoc(ref, {
        ...scoreRound(answers, pids),
        phase: 'reveal',
        revealAt: Date.now(),
      });
      return;
    }

    if (Date.now() - (room.revealAt || 0) < REVEAL_MS) return;

    state.hostBusy = true;
    const next = room.current + 1;
    if (next >= room.order.length) {
      await updateDoc(ref, { status: 'finished' });
    } else {
      await updateDoc(ref, { current: next, phase: 'question' });
    }
  } finally {
    state.hostBusy = false;
  }
}

function scoreRound(answers, pids) {
  const correct = pids
    .filter((pid) => answers[pid]?.correct)
    .sort((a, b) => answers[a].ms - answers[b].ms);

  const total = state.room.settings.timer * 1000;
  const updates = {};

  correct.forEach((pid, rank) => {
    const { ms } = answers[pid];
    const speed = Math.round(SPEED_POINTS * Math.max(0, 1 - ms / total));
    const bonus = rank === 0 && correct.length > 1 ? FIRST_BONUS : 0;
    updates[`players.${pid}.score`] = state.room.players[pid].score + BASE_POINTS + speed + bonus;
  });

  return updates;
}

/* ---------------- results ---------------- */

function renderResults() {
  show('results');
  stopTicker();

  const list = playerList().sort((a, b) => b.score - a.score);
  $('result-players').innerHTML = list.map(playerRow).join('');

  const [first, second] = list;
  const tie = second && first.score === second.score;
  const iWon = first.pid === state.pid;

  $('result-emoji').textContent = tie ? '🤝' : (iWon ? '🏆' : '💐');
  $('result-title').textContent = tie
    ? 'Dead heat!'
    : (iWon ? 'You win!' : `${first.name} wins!`);

  $('btn-again').hidden = !state.isHost;
}

async function playAgain() {
  const reset = {};
  Object.keys(state.room.players).forEach((pid) => { reset[`players.${pid}.score`] = 0; });
  state.roundKey = null;
  await updateDoc(doc(state.db, 'rooms', state.code), {
    ...reset,
    status: 'lobby',
    phase: 'question',
    current: -1,
    order: [],
    answers: {},
  });
}

/* ---------------- teardown ---------------- */

// Detach from the room locally. Deliberately writes nothing: the snapshot
// listener calls this when the document reads as missing, and an empty
// snapshot can be transient (cache eviction, a permissions blip). Writing
// from here would turn a momentary read glitch into a player permanently
// removed from a live game.
function exitToSetup() {
  stopTicker();
  clearInterval(state.hostHandle);
  if (state.unsub) state.unsub();

  const left = { code: state.code, isHost: state.isHost, pid: state.pid };
  state.unsub = null;
  state.room = null;
  state.roundKey = null;
  state.code = null;
  state.hostBusy = false;

  show('setup');
  setError('');
  return left;
}

// User-initiated exit — this one does clean up the room in Firestore.
async function leaveRoom() {
  const { code, isHost, pid } = exitToSetup();
  if (!code) return;
  try {
    if (isHost) await deleteDoc(doc(state.db, 'rooms', code));
    else await updateDoc(doc(state.db, 'rooms', code), { [`players.${pid}`]: deleteField() });
  } catch { /* room may already be gone */ }
}
