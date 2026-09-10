/* audio.js — Rolling sound engine.
   Die face 1..6 → G major pentatonic (G4 A4 B4 D5 E5 G5), so any roll sounds fine.
   One instrument only: a music box (soft sine plucks) — bass, chords and melody
   are just registers of that one voice.
   The bed is generative, not pre-made bars: every roll re-keys it. The hand lying
   on the table picks the chord (a pair is a bare fifth, a triple a triad, a full
   house a thick stack — rarer hand, bigger chord), the dice you lock in rewrite
   the melody figure, and after a hand banks the bed answers with that figure an
   octave up. It sleeps when the player is idle, busies itself as the target nears
   and tightens as hands run out. */
const Sound = (() => {
  let on = false, box, master, rev, mem, hatGain, bp;
  const PENT = [67, 69, 71, 74, 76, 79];           /* G4 A4 B4 D5 E5 G5 */
  const N = m => Tone.Frequency(m, 'midi').toNote();
  /* the pentatonic laid out over two octaves — chords are built as scale degrees
     from a root, so every voicing stays inside the key no matter what it roots on */
  const LAD = [55, 57, 59, 62, 64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91];
  const deg = (root, k) => LAD[Math.max(0, Math.min(LAD.length - 1, LAD.indexOf(root) + k))];
  /* chord shape per hand type, in degrees above the root: loose dice are a
     searching fourth, a pair an open fifth, triples a triad, straights run the
     scale, and the rare hands stack up thick */
  const SHAPES = {
    loose:    [0, 3],
    pair:     [0, 4],
    twoPair:  [0, 3, 4],
    three:    [0, 2, 4],
    str:      [0, 1, 2, 3, 4],
    threeStr: [0, 1, 2, 3, 4, 6],
    full:     [0, 2, 4, 5],
    four:     [0, 2, 4, 6],
    five:     [0, 2, 4, 5, 6],
  };
  let chord = { root: 67, tones: [67, 74] };       /* the harmony the table is lying in */
  let motif = [67, 74, 71];                        /* the figure the bed plays and develops */
  let land = 79;                                   /* root of the last hand played — where multHit lands */
  let mood = { p: 0, u: 0 };                       /* progress to target / urgency from hands left */
  let lastTouch = 0;                               /* any player action wakes the box */

  /* the table's harmony: straights root on their low end, everything else roots
     on the most repeated die — a pair of 4s literally re-keys the bed onto D */
  function harmony(vals, key) {
    const shape = SHAPES[key] || SHAPES.loose;
    let rv = vals[0];
    if (key === 'str' || key === 'threeStr') rv = Math.min(...vals);
    else {
      const cnt = {}; vals.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
      let best = 0;
      Object.keys(cnt).forEach(v => {
        if (cnt[v] > best || (cnt[v] === best && +v > +rv)) { best = cnt[v]; rv = +v; }
      });
    }
    const root = PENT[rv - 1];
    return { root, tones: shape.map(k => deg(root, k)) };
  }
  /* the fallback figure, drawn from the chord — order flips with every roll */
  function boardMotif() {
    const t = chord.tones;
    if (t.length < 3) return (t[0] + t[1]) % 2 ? [t[0], t[1], t[0] + 12] : [t[1], t[0], t[1] + 12];
    const flip = (t[0] + t[t.length - 1]) % 2;
    return flip ? [t[0], t[t.length - 1], t[Math.floor(t.length / 2)]]
                : [t[0], t[Math.floor(t.length / 2)], t[t.length - 1]];
  }

  async function init() {
    if (on) return;
    await Tone.start();
    master = new Tone.Volume(-4).toDestination();
    rev = new Tone.Reverb({ decay: 1.3, wet: 0.1 }).connect(master);
    try { rev.generate(); } catch (e) { /* reverb fills in when ready */ }
    /* the one instrument: kalimba-ish sine plucks */
    box = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.35 },
    }).connect(rev);
    box.volume.value = -8;
    mem = new Tone.MembraneSynth({ envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(master);
    mem.volume.value = -10;
    /* shared noise channel for rattle / tick effects */
    const noise = new Tone.Noise('pink').start();
    hatGain = new Tone.Gain(0); bp = new Tone.Filter(1600, 'bandpass');
    noise.connect(hatGain); hatGain.connect(bp); bp.connect(master);
    /* the bed: reads the game fresh every bar — never the same twice.
       A low root breathes even when idle; the figure lands on slots that
       reshuffle with every roll; the closer to the target (p) and the fewer
       hands left (u), the more of the figure gets played. */
    Tone.Transport.bpm.value = 76;
    new Tone.Loop(t => {
      const idle = Tone.now() - lastTouch > 12;
      const p = idle ? 0 : mood.p, u = idle ? 0 : mood.u;
      const busy = idle ? 1 : Math.min(4, 1 + Math.round(p * 2 + u * 1.5));
      box.triggerAttackRelease(N(chord.root - 12), 1.4, t, idle ? 0.08 : 0.2 + p * 0.05);
      const slots = [0.75, 1.5, 2.25, 3, 3.5];
      const off = (chord.root + chord.tones[chord.tones.length - 1]) % slots.length;
      for (let i = 0; i < busy; i++) {
        const s = slots[(i + off) % slots.length];
        const m = i < motif.length ? motif[i] : motif[motif.length - 1] + 12;  /* tail answers on top */
        box.triggerAttackRelease(N(m), 0.3, t + s, 0.11 + p * 0.05);
      }
    }, 4).start(0);
    Tone.Transport.start();
    on = true;
  }

  /* ---- the table feeds the box ---- */
  function setBed(vals, key) {     /* after every roll: the table's new harmony */
    chord = harmony(vals, key);
    motif = boardMotif();
    if (!on) return;
    const t = Tone.now() + 0.02;
    box.triggerAttackRelease(N(chord.root - 12), 0.4, t, 0.2);   /* say the new chord out loud */
    chord.tones.forEach((m, i) => box.triggerAttackRelease(N(m), 0.3, t + 0.09 + i * 0.07, 0.15));
  }
  function setLocks(vals) {        /* two or more selected dice rewrite the figure */
    const lk = vals.map(v => PENT[v - 1]).sort((a, b) => a - b);
    if (lk.length >= 2) motif = lk.slice(0, 3);
  }
  function setMood(p, u)   { mood = { p: Math.max(0, Math.min(1, p)), u: Math.max(0, Math.min(1, u)) }; }
  function touch()         { if (on) lastTouch = Tone.now(); }      /* any action wakes the box */

  /* ---- picking ---- */
  function pick(v, vals) {     /* selected: the whole selection rolls out as a quick ascending riff —
                                  the player hears what they just played, like strumming a chord */
    if (!on) return;
    const t = Tone.now();
    const ns = (vals && vals.length ? vals : [v]).map(x => PENT[x - 1]).sort((a, b) => a - b);
    ns.forEach((m, i) => box.triggerAttackRelease(N(m), 0.18, t + i * 0.06, 0.24));
  }
  function unpick(v) {         /* released: softer, an octave down */
    if (!on) return;
    box.triggerAttackRelease(N(PENT[v - 1] - 12), 0.1, Tone.now(), 0.12);
  }
  /* a valid hand just formed: brief fifth flick, up */
  function confirm() {
    if (!on) return; const t = Tone.now();
    box.triggerAttackRelease(N(74), 0.2, t, 0.16);
    box.triggerAttackRelease(N(81), 0.25, t + 0.06, 0.14);
  }
  function invalid() { if (on) tick(500, 0.12, undefined, 0.08); }

  /* ---- scoring ---- */
  function handNotes(vals, key) {  /* played dice, low to high, ending on the hand's own root */
    if (!on) return;
    const h = harmony(vals, key);
    land = h.root;
    const t0 = Tone.now() + 0.03;
    [...vals].sort((a, b) => a - b).forEach((v, i) =>
      box.triggerAttackRelease(N(PENT[v - 1]), 0.2, t0 + i * 0.07, 0.34));
    box.triggerAttackRelease(N(h.root + 12), 0.25, t0 + vals.length * 0.07, 0.3);
  }
  function countTick(i) {      /* score climbing: the run rises with the number */
    if (!on) return;
    const m = PENT[i % 6] + 12 * Math.min(2, Math.floor(i / 6));
    box.triggerAttackRelease(N(m), 0.1, Tone.now(), 0.2);
  }
  function multHit() {         /* the multiplier lands on the hand's root and its fifth */
    if (!on) return; const t = Tone.now();
    box.triggerAttackRelease(N(land + 12), 0.2, t, 0.32);
    box.triggerAttackRelease(N(Math.min(deg(land, 4) + 12, 96)), 0.35, t + 0.06, 0.3);
    mem.triggerAttackRelease('G2', 0.06, t, 0.7);
  }
  function respond() {         /* after a hand banks, the bed answers with the figure, up an octave */
    if (!on) return;
    const t0 = Tone.now() + 0.3;
    motif.forEach((m, i) => box.triggerAttackRelease(N(m + 12), 0.2, t0 + i * 0.09, 0.16));
  }

  /* ---- endings ---- */
  function winChord() {        /* rising run, like a payout */
    if (!on) return; const t = Tone.now() + 0.04;
    [67, 71, 74, 79, 83, 86].forEach((m, i) => box.triggerAttackRelease(N(m), 0.25, t + i * 0.07, 0.26));
    box.triggerAttackRelease(N(91), 0.6, t + 0.45, 0.22);
  }
  function loseFall() {        /* falling plucks — collapse, not sludge */
    if (!on) return; const t = Tone.now();
    [79, 76, 71, 67].forEach((m, i) => box.triggerAttackRelease(N(m), 0.25, t + i * 0.12, 0.28));
  }

  /* ---- physical: shake & land ---- */
  function tick(freq = 2200, vel = 0.4, t, dur = 0.05) {
    if (!on) return;
    t = t ?? Tone.now();
    bp.frequency.setValueAtTime(freq, t);
    hatGain.gain.cancelScheduledValues(t);
    hatGain.gain.setValueAtTime(0, t);
    hatGain.gain.linearRampToValueAtTime(vel * 0.5, t + 0.004);
    hatGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  }
  const thump = (t, v = 0.7) => { if (on) mem.triggerAttackRelease('G1', 0.04, t ?? Tone.now(), v); };
  function rollRattle(d = 0.8) {
    if (!on) return;
    const t0 = Tone.now(); let t = 0, s = 0.05;
    while (t < d) { tick(1400 + Math.random() * 1600, 0.25 + Math.random() * 0.2, t0 + t, 0.04); t += s; s *= 1.14; }
    tick(2600, 0.5, t0 + d); thump(t0 + d, 0.5);
  }

  const mute = m => { if (on) master.mute = m; };
  return { init, setBed, setLocks, setMood, touch, pick, unpick, confirm, invalid,
           handNotes, countTick, multHit, respond, winChord, loseFall,
           rollRattle, tick, thump, mute };
})();
