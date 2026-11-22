/* Integrationstest: fährt die komplette App (app.js) mit gemocktem DOM und
   gemocktem WebAudioContext durch: Suche -> Track laden -> Trennung ->
   Layer aktivieren. Geprüft wird, dass jede Layer stimme tatsächlich
   Audio-Quellen (Oszillatoren) plant. Start: node test/engine.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
process.on('unhandledRejection', (r) => console.log('UNHANDLED REJECTION:', (r && r.stack) || r));

/* ---------- Kleiner DOM-Shim ---------- */

const allElements = [];
function classNameMatches(el, cls) {
  return (' ' + (el.className || '') + ' ').indexOf(' ' + cls + ' ') >= 0;
}
function selMatches(el, sel) {
  if (sel.startsWith('.') && sel.includes('.')) {
    return sel.split('.').filter(Boolean).every((p) => classNameMatches(el, p));
  }
  if (sel.startsWith('.')) return classNameMatches(el, sel.slice(1));
  if (sel.startsWith('[data-stem=')) {
    const m = sel.match(/\[data-stem="([^"]+)"\]/);
    return el.dataset.stem === m[1];
  }
  if (sel === 'small') return el.tagName === 'SMALL';
  return el.tagName === sel.toUpperCase();
}
function findDescendants(root, sel) {
  const out = [];
  for (const c of root.children) {
    if (selMatches(c, sel)) out.push(c);
    out.push(...findDescendants(c, sel));
  }
  return out;
}
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    listeners: {},
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    title: '',
    href: '',
    type: '',
    disabled: false,
    max: 0,
    value: '',
    parent: null,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    append(...cs) {
      for (const c of cs) {
        if (typeof c === 'string') this.textContent += c;
        else this.appendChild(c);
      }
    },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    remove() {
      if (this.parent) {
        const i = this.parent.children.indexOf(this);
        if (i >= 0) this.parent.children.splice(i, 1);
      }
    },
    click() { for (const fn of this.listeners.click || []) fn({ target: this, preventDefault() {}, stopPropagation() {} }); },
    dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {} }); },
    querySelector(sel) { return findDescendants(this, sel)[0] || null; },
    querySelectorAll(sel) { return findDescendants(this, sel); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this.__html || ''; },
    set(v) {
      this.__html = v;
      if (v === '') { this.children.length = 0; return; }
      const re = /class="([^"]+)"/g;
      let m;
      while ((m = re.exec(v))) {
        const c = makeEl('div');
        c.className = m[1];
        this.appendChild(c);
      }
    },
  });
  allElements.push(el);
  return el;
}

const registry = {};
function getById(id) {
  if (!registry[id]) registry[id] = makeEl('div');
  return registry[id];
}

/* ---------- WebAudio-Mock mit Startprotokoll ---------- */

let oscStarts = [];
const oscTimes = [];
function makeParam() {
  return {
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  };
}
function makeNode(kind) {
  return {
    __kind: kind,
    connect() {},
    disconnect() {},
    start(t) {
      if (kind === 'osc' || kind === 'src') {
        oscStarts.push({ kind, t: t === undefined ? null : t });
        oscTimes.push(t);
      }
    },
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
function makeAudioBuffer(numChannels, length, sampleRate) {
  const data = [];
  for (let c = 0; c < numChannels; c++) {
    const d = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      d[i] = Math.sin(2 * Math.PI * 220 * (i / sampleRate));
      if (i % Math.round(sampleRate / 2) < 40) d[i] += 0.9 * Math.sign(Math.sin(2 * Math.PI * i / 40));
    }
    data.push(d);
  }
  return {
    numberOfChannels: numChannels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData(c) { return data[c]; },
    copyToChannel(arr, c) { data[c].set(arr); },
  };
}

const sampleRate = 44100;
class MockAudioContext {
  constructor() {
    this.sampleRate = sampleRate;
    this.__time = 0;
    MockAudioContext.last = this;
  }
  get currentTime() { return this.__time; }
  createOscillator() { return makeNode('osc'); }
  createGain() { return makeNode('gain'); }
  createBiquadFilter() { return makeNode('filter'); }
  createBufferSource() { return makeNode('src'); }
  createAnalyser() {
    const n = makeNode('analyser');
    n.fftSize = 2048;
    n.getByteTimeDomainData = () => {};
    return n;
  }
  createBuffer(ch, len, sr) { return makeAudioBuffer(ch, len, sr); }
  decodeAudioData() {
    return new Promise((res) => setTimeout(() => res(makeAudioBuffer(2, 24 * sampleRate, sampleRate)), 10));
  }
  resume() { return Promise.resolve(); }
}

/* ---------- VM-Sandbox ---------- */

const rafCbs = [];
let intervalCbs = [];

const realSetTimeout = setTimeout;
const sandbox = {
  console,
  Math,
  Promise,
  Float32Array,
  Uint8Array,
  Object,
  Array,
  parseInt,
  parseFloat,
  isFinite,
  isNaN,
  String,
  Number,
  setTimeout(fn, ms) { realSetTimeout(() => fn(), Math.min(ms || 0, 50)); return 1; },
  clearTimeout() {},
  setInterval(fn) { intervalCbs.push(fn); return intervalCbs.length; },
  clearInterval() { intervalCbs = []; },
  requestAnimationFrame(fn) { rafCbs.push(fn); return rafCbs.length; },
  cancelAnimationFrame() {},
  StemSeparation: require(path.join(ROOT, 'separate.js')),
  Harmony: require(path.join(ROOT, 'harmony.js')),
  SynthVoices: require(path.join(ROOT, 'synth.js')),
};
sandbox.window = sandbox;
sandbox.AudioContext = MockAudioContext;
sandbox.fetch = async () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(8),
  json: async () => ({ data: [] }),
});
sandbox.document = {
  activeElement: { matches: () => false },
  addEventListener() {},
  createElement: (tag) => makeEl(tag),
  getElementById: getById,
  querySelectorAll(sel) { return allElements.filter((el) => selMatches(el, sel)); },
  body: {
    appendChild(el) {
      if (el.tagName === 'SCRIPT' && el.src) {
        const m = el.src.match(/callback=([^&]+)/);
        const cb = m && sandbox[m[1]];
        if (cb) {
          cb({ data: [{ title: 'Test Song', artist: { name: 'Test Artist' }, album: { cover_medium: '' }, link: '#', duration: 8, preview: 'https://x/test.mp3' }] });
        }
      }
    },
  },
};
sandbox.Audio = function () {
  return { volume: 1, play: () => Promise.resolve(), pause() {}, currentTime: 0 };
};

const ctxv = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'separate.js'), 'utf8'), ctxv);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'harmony.js'), 'utf8'), ctxv);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'synth.js'), 'utf8'), ctxv);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), ctxv);

/* ---------- Treiber ---------- */

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(fn, label, timeoutS) {
  const t0 = Date.now();
  while (!fn()) {
    if ((Date.now() - t0) / 1000 > timeoutS) {
      throw new Error('Timeout beim Warten auf: ' + label + ' status=' + JSON.stringify(registry.status.textContent));
    }
    await sleep(50);
    for (const fn of [...rafCbs]) fn();
    rafCbs.length = 0;
  }
}

function pumpTicks(n, stepS) {
  for (let i = 0; i < n; i++) {
    MockAudioContext.last.__time += stepS;
    for (const fn of [...intervalCbs]) fn();
  }
}

async function main() {
  const failures = [];
  function check(name, cond, extra) {
    if (cond) console.log('PASS', name);
    else { console.log('FAIL', name, extra || ''); failures.push(name); }
  }

  await waitFor(() => (registry['search-form'].listeners.submit || []).length > 0, 'Submit-Handler', 3);
  registry['search-input'].value = 'test song';
  registry['search-form'].dispatch('submit');

  await waitFor(() => (registry.results.children || []).length > 0, 'Suchergebnisse', 5);
  check('Suchergebnis-Karte erzeugt', registry.results.children.length > 0);

  registry.results.children[0].click();
  await waitFor(() => registry['mc-info'].textContent.length > 0, 'Analyse fertig', 60);
  check('Tonart/Tempo erkannt: ' + registry['mc-info'].textContent, true);
  check('Stem-Quellen geplant', oscStarts.length > 0, 'keine Starts nach Laden');

  const layerIds = ['sax', 'kalimba', 'violin', 'accordion', 'coconut', 'dog'];
  for (const id of layerIds) {
    const before = oscStarts.length;
    const row = (registry['layer-rows'].children || []).find((c) => c.dataset.stem === id);
    if (!row || !row.querySelector('.toggle-btn')) {
      check('Layer-Zeile ' + id, false, 'Zeile fehlt');
      continue;
    }
    row.querySelector('.toggle-btn').click();
    pumpTicks(8, 0.25);
    const grew = oscStarts.length > before;
    check('Layer ' + id + ' plant Quellen（' + before + ' -> ' + oscStarts.length + '）', grew);
    row.querySelector('.toggle-btn').click();
    pumpTicks(2, 0.25);
  }

  if (failures.length) {
    console.log('\n' + failures.length + ' FEHLER');
    process.exit(1);
  }
  console.log('\nENGINE TEST: ALLE PRUEFUNGEN BESTANDEN');
  process.exit(0);
}

main().catch((e) => { console.error('HARNESS-FEHLER:', e.message); process.exit(2); });
