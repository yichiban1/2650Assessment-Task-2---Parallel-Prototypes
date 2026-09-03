/* audio.js — PIPS sound engine.
   Die face 1..6 → G major pentatonic (G3 A3 B3 D4 E4 G4), so any roll sounds fine.
   All sounds are short one-shot events; nothing loops or sustains. */
const Sound = (() => {
  let on = false, synth, master, rev, mem, hatGain, bp;
  const PENT = [55, 57, 59, 62, 64, 67];           /* G3 A3 B3 D4 E4 G4 */
  const N = m => Tone.Frequency(m, 'midi').toNote();

  async function init() {
    if (on) return;
    await Tone.start();
    master = new Tone.Volume(-4).toDestination();
    rev = new Tone.Reverb({ decay: 2.4, wet: 0.28 }).connect(master);
    try { rev.generate(); } catch (e) { /* reverb fills in when ready */ }
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.25, sustain: 0.12, release: 0.7 },
    }).connect(rev);
    synth.volume.value = -9;
    mem = new Tone.MembraneSynth({ envelope: { attack: 0.001, decay: 0.22, sustain: 0 } }).connect(master);
    mem.volume.value = -10;
    /* shared noise channel for rattle / tick effects */
    const noise = new Tone.Noise('pink').start();
    hatGain = new Tone.Gain(0); bp = new Tone.Filter(1600, 'bandpass');
    noise.connect(hatGain); hatGain.connect(bp); bp.connect(master);
    on = true;
  }

  /* ---- picking ---- */
  function pick(v) {          /* selected: its note, quick and light */
    if (!on) return;
    synth.triggerAttackRelease(N(PENT[v - 1]), 0.12, Tone.now(), 0.22);
  }
  function unpick(v) {        /* released: same note, softer and shorter */
    if (!on) return;
    synth.triggerAttackRelease(N(PENT[v - 1] - 12), 0.07, Tone.now(), 0.1);
  }
  /* a valid hand just formed: brief fifth swell */
  function confirm() {
    if (!on) return; const t = Tone.now();
    synth.triggerAttackRelease(N(62), 0.5, t, 0.14);
    synth.triggerAttackRelease(N(69), 0.6, t + 0.07, 0.12);
  }
  function invalid() { if (on) tick(500, 0.12, undefined, 0.08); }

  /* ---- scoring ---- */
  function handNotes(vals) {   /* played dice, low to high, quick run */
    if (!on) return;
    const t0 = Tone.now() + 0.03;
    [...vals].sort((a, b) => a - b).forEach((v, i) =>
      synth.triggerAttackRelease(N(PENT[v - 1]), 0.22, t0 + i * 0.09, 0.34));
  }
  function countTick(i) {      /* score climbing: the run rises with the number */
    if (!on) return;
    const m = PENT[i % 6] + 12 * Math.min(2, Math.floor(i / 6));
    synth.triggerAttackRelease(N(m), 0.09, Tone.now(), 0.22);
  }
  function multHit() {         /* the multiplier lands: octave + fifth bloom */
    if (!on) return; const t = Tone.now();
    synth.triggerAttackRelease(N(67 + 12), 0.5, t, 0.3);
    synth.triggerAttackRelease(N(74 + 12), 0.7, t + 0.06, 0.24);
    mem.triggerAttackRelease('G2', 0.1, t, 0.7);
  }

  /* ---- endings ---- */
  function winChord() {
    if (!on) return; const t = Tone.now() + 0.05;
    [55, 62, 67, 74, 79].forEach((m, i) => synth.triggerAttackRelease(N(m), 2.4, t + i * 0.07, 0.24));
  }
  function loseFall() {
    if (!on) return; const t = Tone.now();
    [67, 62, 59, 55].forEach((m, i) => synth.triggerAttackRelease(N(m - 12), 0.5, t + i * 0.16, 0.3));
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
  return { init, pick, unpick, confirm, invalid,
           handNotes, countTick, multHit, winChord, loseFall,
           rollRattle, tick, thump, mute };
})();
