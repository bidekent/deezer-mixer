/* Unit-Test für die synthetisierten Instrumenten-Stimmen (synth.js):
   Jede Voice muss sich mit einem Mock-AudioContext bauen lassen, ohne zu
   werfen, muss mindestens eine Audio-Quelle starten und ein {stop()}-Handle
   liefern. Stellt sicher, dass ein Defekt in einer Voice den Layer-Scheduler
   nicht mehr lahmlegen kann. Start: node test/voices.test.js */
'use strict';

const SynthVoices = require('../synth.js');

let started = [];
function makeParam() {
  return {
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  };
}
function makeNode() {
  return {
    connect() {},
    disconnect() {},
    start(t) { started.push(t); },
    stop() {},
    type: '',
    loop: false,
    buffer: null,
    frequency: makeParam(),
    detune: makeParam(),
    gain: makeParam(),
    Q: makeParam(),
  };
}
function makeCtx() {
  return {
    sampleRate: 44100,
    currentTime: 0,
    destination: {},
    createOscillator: makeNode,
    createGain: makeNode,
    createBiquadFilter: makeNode,
    createBufferSource: makeNode,
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; },
  };
}

const failures = [];
for (const id of ['sax', 'kalimba', 'violin', 'accordion', 'coconut', 'dog']) {
  const fn = SynthVoices[id];
  if (typeof fn !== 'function') { failures.push(id + ': Voice fehlt'); continue; }
  started = [];
  try {
    const handle = fn(makeCtx(), { connect() {} }, 1.0,
      { freq: 261.6, notes: [261.6, 329.6, 392.0], dur: 0.5, vel: 0.5, det: 0 });
    if (!handle || typeof handle.stop !== 'function') failures.push(id + ': kein stop-Handle');
    else if (!started.length) failures.push(id + ': startet keine Audio-Quelle');
    else console.log('ok', id + ': ' + started.length + ' Quellen gestartet');
    if (handle) handle.stop();
  } catch (e) {
    failures.push(id + ' WURF: ' + e.message);
  }
}

/* Edge-Cases: dennoch keine Exception */
for (const id of Object.keys(SynthVoices)) {
  try {
    const handle = SynthVoices[id](makeCtx(), { connect() {} }, 0.01,
      { freq: 0.001, notes: [], dur: 0, vel: 0, det: 3 });
    if (handle) handle.stop();
  } catch (e) {
    failures.push(id + ' (Edge) WURF: ' + e.message);
  }
}

if (failures.length) {
  for (const f of failures) console.log('FAIL', f);
  console.log(failures.length + ' FEHLER');
  process.exit(1);
}
console.log('ALL TESTS PASSED');
