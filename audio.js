/* audio.js — Rolling sound engine.
   Die face 1..6 → G major pentatonic (G4 A4 B4 D5 E5 G5), so any roll sounds fine.
   One instrument only: a music box (soft sine plucks). Every tonal sound — clicks,
   hand runs, count-up, endings — plays on it, so the whole game speaks one voice.
   The bed is NOT a loop of pre-made bars: it reads the game every bar — sleeps
   when the player is idle, gets busier as the target nears, tighter as hands
   run out, and every roll reshuffles the bar's layout. */
const Sound = (() => {
  let on = false, box, master, rev, mem, hatGain, bp;
  const PENT = [67, 69, 71, 74, 76, 79];           /* G4 A4 B4 D5 E5 G5 */
  const N = m => Tone.Frequency(m, 'midi').toNote();
  let bedNotes = [55, 62, 67, 74];                 /* fallback until the first roll lands */
  let locks = [];                                  /* dice the player selected — the box features these */
  let mood = { p: 0, u: 0 };                       /* progress to target / urgency from hands left */
  let lastTouch = 0;                               /* any player action wakes the box */

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
       idle → just the root, breathing. Playing → sprinkles. The closer to the
       target (p) and the fewer hands left (u), the more slots light up. */
    Tone.Transport.bpm.value = 76;
    new Tone.Loop(t => {
      const ns = [...bedNotes].sort((a, b) => a - b);
      const lk = [...locks].sort((a, b) => a - b);
      const idle = Tone.now() - lastTouch > 12;
      const p = idle ? 0 : mood.p, u = idle ? 0 : mood.u;
      const busy = idle ? 0 : Math.min(4, 1 + Math.round(p * 2 + u * 1.5));
      const slots = [0.75, 1.5, 2.5, 3.25];
      const off = (ns[0] + ns[ns.length - 1]) % 4;         /* each roll shuffles the layout */
      box.triggerAttackRelease(N(ns[0] - 12), 0.8, t, 0.16 + p * 0.06);   /* the root, always */
      for (let i = 0; i < busy; i++) {
        const s = slots[(i + off) % 4];
        const note = lk.length ? lk[i % lk.length] + (i === 2 ? 12 : 0)
                               : ns[(i + 1) % ns.length] + (i === 2 ? 12 : 0);
        box.triggerAttackRelease(N(note), 0.3, t + s, 0.13 + p * 0.05);
      }
    }, 4).start(0);
    Tone.Transport.start();
    on = true;
  }

  /* ---- the table feeds the box ---- */
  function setBed(vals) {          /* after every roll: new material + say it out loud */
    bedNotes = vals.map(v => PENT[v - 1]);
    if (!on) return;
    const t = Tone.now() + 0.02;
    const ns = [...bedNotes].sort((a, b) => a - b);
    box.triggerAttackRelease(N(ns[0] - 12), 0.3, t, 0.2);
    box.triggerAttackRelease(N(ns[Math.min(2, ns.length - 1)]), 0.25, t + 0.09, 0.18);
    box.triggerAttackRelease(N(ns[ns.length - 1] + 12), 0.3, t + 0.18, 0.16);
  }
  function setLocks(vals) { locks = vals.map(v => PENT[v - 1]); }   /* selected dice join the bed */
  function setMood(p, u)   { mood = { p: Math.max(0, Math.min(1, p)), u: Math.max(0, Math.min(1, u)) }; }
  function touch()         { if (on) lastTouch = Tone.now(); }      /* any action wakes the box */

  /* ---- picking ---- */
  function pick(v) {           /* selected: its note rings once, then lives in the bed */
    if (!on) return;
    box.triggerAttackRelease(N(PENT[v - 1]), 0.15, Tone.now(), 0.3);
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
  function handNotes(vals) {   /* played dice, low to high, quick run */
    if (!on) return;
    const t0 = Tone.now() + 0.03;
    [...vals].sort((a, b) => a - b).forEach((v, i) =>
      box.triggerAttackRelease(N(PENT[v - 1]), 0.2, t0 + i * 0.07, 0.34));
  }
  function countTick(i) {      /* score climbing: the run rises with the number */
    if (!on) return;
    const m = PENT[i % 6] + 12 * Math.min(2, Math.floor(i / 6));
    box.triggerAttackRelease(N(m), 0.1, Tone.now(), 0.2);
  }
  function multHit() {         /* the multiplier lands: two bright notes + thump */
    if (!on) return; const t = Tone.now();
    box.triggerAttackRelease(N(86), 0.2, t, 0.32);
    box.triggerAttackRelease(N(91), 0.35, t + 0.06, 0.3);
    mem.triggerAttackRelease('G2', 0.06, t, 0.7);
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
           handNotes, countTick, multHit, winChord, loseFall,
           rollRattle, tick, thump, mute };
})();
