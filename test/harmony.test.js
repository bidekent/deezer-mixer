const Harmony = require('../harmony.js');

const failures = [];
function check(cond, okMsg, failMsg) {
  if (cond) console.log(`ok   ${okMsg}`);
  else failures.push(new Error(`FAIL ${failMsg}`));
}

function main() {
  const fps = 44100 / 512;

  const env = new Float32Array(Math.ceil(fps * 30));
  for (let i = 0; i < env.length; i++) {
    const t = i / fps;
    for (let click = 0; click < 60; click++) {
      if (Math.abs(t - click * 0.5) < 0.02) env[i] = 1;
    }
  }
  const bpm = Harmony.estimateBPM(env, fps);
  check(bpm >= 118 && bpm <= 122, `BPM detected ~120 (got ${bpm})`, `BPM wrong: ${bpm}`);

  const chromaCMajor = new Array(12).fill(0.1);
  chromaCMajor[0] = 1; chromaCMajor[4] = 0.8; chromaCMajor[7] = 0.7;
  const key = Harmony.estimateKey(chromaCMajor);
  check(key.tonic === 0 && key.mode === 'Dur', `C major detected (got ${Harmony.NOTE_NAMES[key.tonic]}-${key.mode})`,
    `key wrong: ${Harmony.NOTE_NAMES[key.tonic]}-${key.mode}`);

  const chromaAMinor = new Array(12).fill(0.1);
  chromaAMinor[9] = 1; chromaAMinor[0] = 0.7; chromaAMinor[4] = 0.8;
  const key2 = Harmony.estimateKey(chromaAMinor);
  check(key2.tonic === 9 && key2.mode === 'Moll', `A minor detected (got ${Harmony.NOTE_NAMES[key2.tonic]}-${key2.mode})`,
    `key2 wrong: ${Harmony.NOTE_NAMES[key2.tonic]}-${key2.mode}`);

  const mc = Harmony.buildMusicalContext(key);
  check(Math.abs(mc.rootFreq - 261.6) < 1, `root C4 ~261.6Hz (got ${mc.rootFreq.toFixed(1)})`, `rootFreq wrong: ${mc.rootFreq}`);
  check(Math.abs(mc.degFreq(7) / mc.rootFreq - 2) < 0.001, 'degree 7 is one octave above root', 'degFreq(7) wrong');
  check(mc.chords.length === 4 && mc.chords[0].length === 3, '4 triads built', 'chords wrong');
  check(mc.chordForBar(0) === mc.chordForBar(1), 'chords change every 2 bars', 'chordForBar wrong');

  for (const id of ['sax', 'kalimba', 'violin', 'accordion', 'coconut', 'dog']) {
    const pat = Harmony.buildPattern(id, mc, 120);
    let eventsSorted = true, inLoop = true;
    for (let i = 1; i < pat.events.length; i++) if (pat.events[i].t < pat.events[i - 1].t) eventsSorted = false;
    for (const ev of pat.events) if (ev.t < 0 || ev.t >= pat.loopDur) inLoop = false;
    check(pat.events.length > 0 && eventsSorted && inLoop,
      `pattern ${id}: ${pat.events.length} events sorted in-loop`,
      `pattern ${id} invalid`);
    for (const ev of pat.events) {
      if (ev.notes) {
        for (const f of ev.notes) {
          if (!isFinite(f) || f <= 20 || f > 12000) failures.push(new Error(`FAIL ${id}: frequency ${f}`));
        }
      }
    }
  }

  for (const f of failures) console.error(f.message);
  if (failures.length) { console.error(`${failures.length} test(s) FAILED`); process.exit(1); }
  console.log('ALL TESTS PASSED');
}

main();
