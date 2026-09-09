/* main.js — Rolling: a small dice game.
   Roll six dice, select some into a poker hand, play it for chips × mult,
   and clear the score target before the hands run out. Three rounds, targets rise.
   The gamble: shaking only rerolls the dice you did NOT select, so every turn is
   "lock the dice you like, risk the rest". */
(() => {
const $ = id => document.getElementById(id);
const els = {
  table: $('table'), dice: $('diceMount'), stamp: $('stampLayer'),
  msg: $('msg'), score: $('scoreEl'), target: $('targetEl'),
  hands: $('handsEl'), rerolls: $('rerollsEl'), round: $('roundEl'),
  pName: $('pName'), pMath: $('pMath'), playBtn: $('playBtn'), prog: $('progFill'),
  comboList: $('comboList'), end: $('end'), endName: $('endName'),
  endStats: $('endStats'),
};

/* ---- tunables — play with these ---- */
const ROUNDS = [500, 1300, 2600];   /* target score per round */
const HANDS = 4;                    /* plays per round */
const SHAKES = 3;                   /* rerolls per round */
const PIP_CHIPS = 5;                /* chips per pip */
/* hand values: mult does the escalating — pairs are routine money,
   the big multipliers on rare hands are what worth shaking for */
const TYPES = {
  five:      { name: 'five of a kind', base: 100, mult: 8 },
  threeStr:  { name: 'big straight',   base: 60,  mult: 5 },
  four:      { name: 'four',           base: 50,  mult: 6 },
  full:      { name: 'full house',     base: 40,  mult: 4 },
  str:       { name: 'small straight', base: 30,  mult: 4 },
  three:     { name: 'three',          base: 30,  mult: 3 },
  twoPair:   { name: 'two pair',       base: 20,  mult: 2 },
  pair:      { name: 'pair',           base: 15,  mult: 2 },
  high:      { name: 'high die',       base: 5,   mult: 1 },
};
const TYPE_ORDER = ['five', 'four', 'threeStr', 'full', 'str', 'three', 'twoPair', 'pair', 'high'];
/* ----------------------------------- */

const rnd = () => 1 + Math.random() * 6 | 0;   /* 1..6 — |0 truncates, so the +1 has to come first */
let S = null, hold = null, timers = [], counting = false;
const later = (fn, ms) => timers.push(setTimeout(fn, ms));   /* pending timeouts, cleared on restart */

/* ---------- dice ---------- */
const dice = [];
for (let i = 0; i < 6; i++) {
  const w = document.createElement('div'); w.className = 'die-wrap';
  const d = document.createElement('div'); d.className = 'die'; d.dataset.v = 1;
  for (let p = 0; p < 9; p++) d.appendChild(document.createElement('span')).className = 'pip';
  const sh = document.createElement('div'); sh.className = 'shadow';
  w.appendChild(d); w.appendChild(sh); els.dice.appendChild(w);
  d.addEventListener('click', () => toggleSelect(i));
  dice.push({ w, d });
}

/* ---------- combo table ---------- */
TYPE_ORDER.forEach(k => {
  const t = TYPES[k], row = document.createElement('div');
  row.className = 'crow'; row.dataset.t = k;
  row.innerHTML = '<span class="cname">' + t.name + '</span><span class="cmath">' + t.base + ' × ' + t.mult + '</span>';
  els.comboList.appendChild(row);
});

/* ---------- rendering ---------- */
function renderMeta() {
  els.score.textContent = S.score;
  els.target.textContent = '/ ' + S.target;
  els.hands.textContent = S.hands;
  els.rerolls.textContent = S.shakes;
  els.round.textContent = (S.round + 1) + '/' + ROUNDS.length;
  els.playBtn.disabled = !currentCombo();
  updateProgress();
  /* the box tracks the game: closer to target = busier, fewer hands = tighter */
  try { Sound.setMood(Math.min(1, S.score / S.target), 1 - S.hands / HANDS); } catch (e) {}
}
function updateProgress() {
  els.prog.style.width = Math.min(100, S.score / S.target * 100) + '%';
}
function renderPreview() {
  const c = currentCombo();
  const can = formable();
  document.querySelectorAll('.crow').forEach(r => {
    r.classList.toggle('on', !!c && c.key === r.dataset.t);
    r.classList.toggle('can', can.has(r.dataset.t));
  });
  if (!c) {
    els.pName.textContent = '—';
    els.pMath.textContent = '';
    return;
  }
  const chips = TYPES[c.key].base + c.sum * PIP_CHIPS;
  els.pName.textContent = TYPES[c.key].name;
  els.pMath.textContent = chips + ' × ' + TYPES[c.key].mult;
}
/* which hands the table dice could still make — 64 subsets is cheap to brute-force */
function formable() {
  const keys = new Set();
  for (let mask = 1; mask < 64; mask++) {
    const vals = [];
    for (let i = 0; i < 6; i++) if (mask & (1 << i)) vals.push(S.vals[i]);
    const c = detect(vals);
    if (c && c.key !== 'high') keys.add(c.key);
  }
  return keys;
}
const msg = t => els.msg.textContent = t;
function stamp(text, cls = '') {
  const s = document.createElement('div');
  s.className = 'stamp ' + cls; s.textContent = text;
  els.stamp.appendChild(s);
  later(() => s.remove(), 1100);
}

/* ---------- combo detection ---------- */
function detect(vals) {
  const n = vals.length;
  if (!n) return null;
  if (n === 1) return { key: 'high', sum: vals[0] };
  const cnt = {}; vals.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
  const counts = Object.values(cnt).sort((a, b) => b - a);
  const uniq = Object.keys(cnt).map(Number).sort((a, b) => a - b);
  const straight = len => {
    for (let i = 0; i + len <= uniq.length; i++) {
      let ok = true;
      for (let j = 1; j < len; j++) if (uniq[i + j] !== uniq[i] + j) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };
  /* rarer hands first — a selection always scores as the best type it makes */
  if (counts[0] === 5) return { key: 'five', sum: vals.reduce((a, b) => a + b) };
  if (counts[0] === 4) return { key: 'four', sum: vals.reduce((a, b) => a + b) };
  if (counts[0] === 3 && counts[1] >= 2) return { key: 'full', sum: vals.reduce((a, b) => a + b) };
  if (n >= 5 && straight(5)) return { key: 'threeStr', sum: vals.reduce((a, b) => a + b) };
  if (n >= 4 && straight(4)) return { key: 'str', sum: vals.reduce((a, b) => a + b) };
  if (counts[0] === 3) return { key: 'three', sum: vals.reduce((a, b) => a + b) };
  if (counts[0] === 2 && counts[1] === 2) return { key: 'twoPair', sum: vals.reduce((a, b) => a + b) };
  if (counts[0] === 2) return { key: 'pair', sum: vals.reduce((a, b) => a + b) };
  return null;   /* loose dice — not a hand */
}
const selected = () => dice.map((_, i) => S.d[i]).filter(v => v !== null);
function currentCombo() { return detect(selected()); }

/* ---------- selection: one short blip per click ---------- */
function toggleSelect(i) {
  if (!S || S.rolling || counting || S.phase !== 'PLAY') return;
  const wasValid = !!currentCombo();
  try {
    if (S.d[i] === null) { S.d[i] = S.vals[i]; Sound.pick(S.vals[i]); }
    else { S.d[i] = null; Sound.unpick(S.vals[i]); }
    if (!wasValid && !!currentCombo()) Sound.confirm();
    Sound.setLocks(selected());   /* locked dice take the spotlight in the bed */
    Sound.touch();
  } catch (e) { /* audio must never block the game */ }
  renderDice(); renderPreview(); renderMeta();
}
/* die values: null = unselected, number = selected */
function renderDice() {
  dice.forEach(({ d }, i) => {
    d.dataset.v = S.vals[i];
    d.classList.toggle('sel', S.d[i] !== null);
  });
}

/* ---------- rolling ---------- */
function rollDice(which, done) {
  S.rolling = true;
  try { Sound.rollRattle(0.8); } catch (e) {}
  const idx = which;
  idx.forEach((i, k) => {
    dice[i].d.classList.remove('sel');
    dice[i].w.classList.add('rolling');
    dice[i].w.style.animationDelay = (k * 0.06) + 's';
  });
  idx.forEach(i => { later(() => S.vals[i] = rnd(), 280); later(() => S.vals[i] = rnd(), 540); });
  later(() => idx.forEach(i => {
    S.vals[i] = rnd();
    dice[i].d.classList.add('settle');
    later(() => dice[i].d.classList.remove('settle'), 260);
  }), 800);
  later(() => {
    idx.forEach(i => { dice[i].w.classList.remove('rolling'); dice[i].w.style.animationDelay = ''; });
    S.rolling = false;
    try { Sound.setBed(S.vals); Sound.touch(); } catch (e) {}   /* the box learns the new dice */
    if (done) done();
  }, 880);
}

/* ---------- shake: hold to reroll the loose dice ---------- */
function startShake() {
  if (!S || S.rolling || counting || S.phase !== 'PLAY' || hold) return;
  if (S.shakes <= 0) { msg('no shakes left — play what you hold'); return; }
  const loose = [];
  S.d.forEach((v, i) => { if (v === null) loose.push(i); });
  if (!loose.length) { msg('everything is selected — play it'); return; }
  hold = { t0: performance.now(), iv: setInterval(() => {
    const el = performance.now() - hold.t0;
    const tier = el < 260 ? 1 : el < 650 ? 2 : 3;
    loose.forEach(i => dice[i].w.className = 'die-wrap w' + tier);
    Sound.tick(1500 + Math.random() * 1400, 0.15 + tier * 0.07, undefined, 0.035);
  }, 105) };
}
function releaseShake() {
  if (!hold) return;
  clearInterval(hold.iv); hold = null;
  dice.forEach(({ w }) => w.className = 'die-wrap');
  const loose = [];
  S.d.forEach((v, i) => { if (v === null) loose.push(i); });
  if (!loose.length) return;
  S.shakes--; renderMeta();
  msg('shaking the loose dice…');
  rollDice(loose, () => { renderDice(); renderPreview(); renderMeta(); msg('select dice — or shake again'); });
}

/* ---------- play a hand ---------- */
els.playBtn.addEventListener('click', () => {
  if (!S || S.rolling || counting || S.phase !== 'PLAY') return;
  const c = currentCombo();
  if (!c) { Sound.invalid(); msg('loose dice don\u2019t make a hand — pair them up or shake'); return; }
  playHand(c);
});

function playHand(c) {
  counting = true;
  els.playBtn.disabled = true;   /* no re-triggers while the score counts up */
  try { Sound.touch(); } catch (e) {}
  const t = TYPES[c.key];
  const vals = selected();
  const chips = t.base + c.sum * PIP_CHIPS;
  const gain = chips * t.mult;
  const selIdx = [];
  S.d.forEach((v, i) => { if (v !== null) selIdx.push(i); });

  try { Sound.handNotes(vals); } catch (e) { /* audio must never block the game */ }
  stamp(t.name.toUpperCase(), t.mult >= 4 ? 'gold' : '');
  selIdx.forEach(i => dice[i].d.classList.add('fired'));

  /* chips count up first… */
  let shown = 0;
  const chipIv = setInterval(() => {
    shown = Math.min(chips, shown + Math.max(1, Math.ceil(chips / 18)));
    els.pMath.textContent = shown + ' × ' + t.mult;
    try { Sound.countTick(Math.floor(shown / Math.max(1, chips) * 11)); } catch (e) {}
    if (shown >= chips) {
      clearInterval(chipIv);
      try { Sound.multHit(); } catch (e) {}
      els.pMath.classList.add('hot');
      later(() => els.pMath.classList.remove('hot'), 500);
      countScore(S.score, S.score + gain);
    }
  }, 45);
}

function countScore(from, to) {
  let v = from;
  const iv = setInterval(() => {
    v = Math.min(to, v + Math.max(1, Math.ceil((to - from) / 22)));
    S.score = v; els.score.textContent = v; updateProgress();
    if (v >= to) {
      clearInterval(iv);
      counting = false;
      afterPlay();
    }
  }, 40);
}

function afterPlay() {
  S.hands--; renderMeta();
  dice.forEach(({ d }) => d.classList.remove('fired'));
  els.pName.textContent = '—'; els.pMath.textContent = '';
  document.querySelectorAll('.crow').forEach(r => r.classList.remove('on'));
  if (S.score >= S.target) { roundClear(); return; }
  if (S.hands <= 0) { gameOver(false); return; }
  nextHand();
}

function nextHand() {
  S.d = [null, null, null, null, null, null];
  S.phase = 'ROLL';
  try { Sound.setLocks([]); } catch (e) {}   /* fresh hand, empty spotlight */
  msg('fresh dice —');
  rollDice([0, 1, 2, 3, 4, 5], () => {
    S.phase = 'PLAY';
    renderDice(); renderPreview(); renderMeta();
    msg('select dice to form a hand — hold to shake the rest');
  });
}

/* ---------- rounds ---------- */
function newGame() {
  timers.forEach(clearTimeout); timers = [];
  S = { phase: 'ROLL', round: 0, target: ROUNDS[0], score: 0, hands: HANDS,
        shakes: SHAKES, d: [null, null, null, null, null, null],
        vals: [1, 2, 3, 4, 5, 6], rolling: false };
  els.end.classList.remove('show');
  els.stamp.innerHTML = '';
  dice.forEach(({ d }) => { d.classList.remove('sel', 'fired'); });
  renderMeta(); renderPreview();
  nextHand();
}

function roundClear() {
  S.phase = 'BETWEEN';
  try { Sound.winChord(); } catch (e) {}
  if (S.round >= ROUNDS.length - 1) { gameOver(true); return; }
  stamp('ROUND CLEAR', 'gold');
  msg('the table warms up — next target coming');
  later(() => {
    S.round++;
    S.target = ROUNDS[S.round];
    S.hands = HANDS; S.shakes = SHAKES;
    renderMeta();
    nextHand();
  }, 1600);
}

function gameOver(won) {
  S.phase = 'OVER';
  try { if (won) Sound.winChord(); else Sound.loseFall(); } catch (e) {}
  els.endName.textContent = won ? '\u201Cclean sweep\u201D' : '\u201Cshort stack\u201D';
  els.endStats.textContent = 'score ' + S.score + ' / ' + S.target + ' · round ' + (S.round + 1) + ' of ' + ROUNDS.length;
  later(() => els.end.classList.add('show'), won ? 900 : 1200);
}

/* ---------- wiring ---------- */
els.table.addEventListener('pointerdown', e => {
  if (e.target.closest('.hud, .die, button, .combos, .end, a')) return;
  startShake();
});
window.addEventListener('pointerup', releaseShake);
window.addEventListener('pointercancel', releaseShake);
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat) { e.preventDefault(); startShake(); }
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !els.playBtn.disabled) els.playBtn.click();
});
window.addEventListener('keyup', e => { if (e.code === 'Space') releaseShake(); });

$('muteBtn').addEventListener('click', () => {
  const m = $('muteBtn').textContent === 'sound on';
  Sound.mute(m);
  $('muteBtn').textContent = m ? 'sound off' : 'sound on';
});
/* audio needs a user gesture — the first click/keypress wakes it up */
const wake = () => { Sound.init().catch(() => {}); };
window.addEventListener('pointerdown', wake, { once: true });
window.addEventListener('keydown', wake, { once: true });
$('againBtn').addEventListener('click', newGame);

newGame();
})();
