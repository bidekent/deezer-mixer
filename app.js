/* Deezer Mixer – Suche, Wiedergabe, Stem-Trennung und Mute-Steuerung */
(function () {
  'use strict';

  const STEMS = [
    { id: 'vocals', label: 'Gesang', icon: '🎤' },
    { id: 'drums', label: 'Schlagzeug', icon: '🥁' },
    { id: 'bass', label: 'Bass', icon: '🎸' },
    { id: 'other', label: 'Andere Instrumente', icon: '🎹' },
  ];

  const $ = (id) => document.getElementById(id);

  const LAYERS = [
    { id: 'sax', label: 'Saxophon', icon: '🎷', gain: 0.30 },
    { id: 'kalimba', label: 'Kalimba', icon: '🪵', gain: 0.25 },
    { id: 'violin', label: 'Geige', icon: '🎻', gain: 0.22 },
    { id: 'accordion', label: 'Ziehharmonika', icon: '🪗', gain: 0.28 },
    { id: 'coconut', label: 'Kokusnuss-Geklapper', icon: '🥥', gain: 0.45 },
    { id: 'dog', label: 'Hundegebell', icon: '🐕', gain: 0.50 },
  ];

  const ui = {
    form: $('search-form'),
    input: $('search-input'),
    searchBtn: $('search-btn'),
    suggestions: $('suggestions'),
    status: $('status'),
    results: $('results'),
    player: $('player'),
    npCover: $('np-cover'),
    npTitle: $('np-title'),
    npArtist: $('np-artist'),
    npLink: $('np-link'),
    btnPlay: $('btn-play'),
    timeCur: $('time-cur'),
    timeTotal: $('time-total'),
    seek: $('seek'),
    volume: $('volume'),
    analysisLine: $('analysis-line'),
    analysisBar: $('analysis-bar'),
    analysisLabel: $('analysis-label'),
    stemRows: $('stem-rows'),
    btnAll: $('btn-all'),
    layersBlock: $('layers-block'),
    layerRows: $('layer-rows'),
    mcInfo: $('mc-info'),
    srcBtns: document.querySelectorAll('.src-btn'),
  };

  const state = {
    audioCtx: null,
    masterGain: null,
    stemGains: {},
    analysers: {},
    meterData: null,
    stemBuffers: {},
    sources: [],
    duration: 0,
    playing: false,
    offset: 0,
    startedAt: 0,
    muted: {},
    rafId: null,
    currentTrack: null,
    mode: 'idle',
    fallbackAudio: null,
    loadToken: 0,
    volume: 1,
    source: 'deezer',
    audiusHosts: null,
    bpm: null,
    mc: null,
    trimmedNote: '',
    layers: { enabled: {}, gains: {}, analysers: {}, handles: {}, nextIdx: {}, loop: {}, patterns: {}, timer: null },
  };

  function ensureAudioCtx() {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      state.masterGain = state.audioCtx.createGain();
      state.masterGain.gain.value = state.volume;
      state.masterGain.connect(state.audioCtx.destination);
      state.meterData = new Uint8Array(2048);
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    return state.audioCtx;
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function setStatus(text, isError) {
    ui.status.textContent = text;
    ui.status.classList.toggle('error', !!isError);
    ui.status.classList.toggle('hidden', !text);
  }

  function setAnalysis(pct, label) {
    if (pct == null) return;
    ui.analysisBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (label) ui.analysisLabel.textContent = label;
  }

  /* ---------- Deezer Suche ---------- */

  function searchDeezer(query) {
    return new Promise((resolve, reject) => {
      const cbName = '__dz_cb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 10000);
      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        script.remove();
      }
      window[cbName] = (data) => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('Deezer API nicht erreichbar')); };
      script.src = 'https://api.deezer.com/search?q=' + encodeURIComponent(query) +
        '&limit=24&output=jsonp&callback=' + cbName;
      document.body.appendChild(script);
    });
  }

  function renderResults(tracks) {
    ui.results.innerHTML = '';
    const playable = tracks.filter((t) => t && t.audioUrl);
    if (!playable.length) {
      setStatus('Keine abspielbaren Treffer gefunden.', true);
      return;
    }
    setStatus(playable.length + ' Treffer – Titel antippen zum Analysieren & Abspielen.');
    for (const t of playable) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'track-card';
      card.innerHTML =
        '<img loading="lazy" alt="" src="' + (t.cover || '') + '">' +
        '<span class="tc-meta">' +
        '<span class="tc-title"></span>' +
        '<span class="tc-artist"></span>' +
        '</span>';
      card.querySelector('.tc-title').textContent = t.title || '';
      card.querySelector('.tc-artist').textContent = t.artist || '';
      card.addEventListener('click', () => {
        document.querySelectorAll('.track-card.active').forEach((el) => el.classList.remove('active'));
        card.classList.add('active');
        loadTrack(t);
      });
      ui.results.appendChild(card);
    }
  }

  /* ---------- Audius ---------- */

  async function fetchAudiusHosts() {
    if (state.audiusHosts && state.audiusHosts.length) return state.audiusHosts;
    const resp = await fetch('https://api.audius.co');
    if (!resp.ok) throw new Error('Audius nicht erreichbar');
    const j = await resp.json();
    state.audiusHosts = (j && j.data) || [];
    return state.audiusHosts;
  }

  function audiusStreamUrl(id) {
    const hosts = state.audiusHosts && state.audiusHosts.length
      ? state.audiusHosts
      : ['https://discoveryprovider.audius.co'];
    const host = hosts[Math.floor(Math.random() * hosts.length)];
    return host + '/v1/tracks/' + id + '/stream?app_name=DeezerMixer';
  }

  async function searchAudius(query) {
    const hosts = await fetchAudiusHosts();
    if (!hosts.length) throw new Error('Audius nicht erreichbar');
    const host = hosts[Math.floor(Math.random() * hosts.length)];
    const resp = await fetch(host + '/v1/tracks/search?query=' + encodeURIComponent(query) + '&app_name=DeezerMixer');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    return (j.data || [])
      .filter((t) => t && t.id && !t.is_delete && t.is_streamable !== false)
      .map((t) => ({
        source: 'audius',
        title: t.title || '',
        artist: (t.user && t.user.name) || '',
        cover: (t.artwork && (t.artwork['480x480'] || t.artwork['150x150'])) || '',
        link: t.permalink ? 'https://audius.co' + t.permalink : 'https://audius.co',
        duration: t.duration,
        audioUrl: () => audiusStreamUrl(t.id),
      }));
  }

  function normalizeDeezerTracks(data) {
    return ((data && data.data) || []).filter((t) => t && t.preview).map((t) => ({
      source: 'deezer',
      title: t.title || '',
      artist: (t.artist && t.artist.name) || '',
      cover: (t.album && t.album.cover_medium) || '',
      link: t.link,
      duration: t.duration,
      audioUrl: t.preview,
    }));
  }

  /* ---------- Laden & Analysieren ---------- */

  function sliceBufferHead(ctx, buf, maxSec) {
    const len = Math.min(buf.length, Math.round(maxSec * buf.sampleRate));
    if (len >= buf.length) return buf;
    const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      out.copyToChannel(buf.getChannelData(c).subarray(0, len), c);
    }
    return out;
  }

  async function loadTrack(track) {
    const token = ++state.loadToken;
    stopPlayback();
    if (state.fallbackAudio) { state.fallbackAudio.pause(); state.fallbackAudio = null; }

    state.currentTrack = track;
    ui.npCover.src = track.cover || '';
    ui.npTitle.textContent = track.title || '';
    ui.npArtist.textContent = track.artist || '';
    ui.npLink.href = track.link || '#';
    ui.player.classList.remove('hidden');
    ui.analysisLine.classList.remove('hidden');
    setAnalysis(0, 'Lade 30s-Preview …');
    setStatus('');
    buildStemRows(true);

    ensureAudioCtx();
    let arrayBuffer;
    try {
      const audioUrl = typeof track.audioUrl === 'function' ? track.audioUrl() : track.audioUrl;
      const resp = await fetch(audioUrl);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      arrayBuffer = await resp.arrayBuffer();
    } catch (e) {
      enterFallbackMode(track);
      return;
    }
    if (token !== state.loadToken) return;

    let audioBuffer;
    try {
      setAnalysis(2, 'Dekodiere Audio …');
      audioBuffer = await state.audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) {
      setStatus('Audio konnte nicht dekodiert werden.', true);
      setAnalysis(0, '');
      return;
    }
    if (token !== state.loadToken) return;

    state.trimmedNote = '';
    if (track.source === 'audius' && audioBuffer.duration > 180.5) {
      audioBuffer = sliceBufferHead(state.audioCtx, audioBuffer, 180);
      state.trimmedNote = ' (Audius: Analyse & Wiedergabe auf die ersten 3 Minuten begrenzt)';
    }

    try {
      const sep = await StemSeparation.separateStems(audioBuffer, (pct, label) => {
        if (token === state.loadToken) setAnalysis(pct, label || 'Analysiere …');
      });
      if (token !== state.loadToken) return;
      installStems(audioBuffer, sep, track);
    } catch (e) {
      setStatus('Analyse fehlgeschlagen: ' + e.message, true);
    }
  }

  function installStems(audioBuffer, sep, track) {
    state.stemBuffers = {};
    for (const def of STEMS) {
      const raw = sep.stems[def.id];
      const buf = state.audioCtx.createBuffer(2, raw.L.length, sep.sampleRate);
      buf.copyToChannel(new Float32Array(raw.L), 0);
      buf.copyToChannel(new Float32Array(raw.R), 1);
      state.stemBuffers[def.id] = buf;
    }

    state.stemGains = {};
    state.analysers = {};
    state.muted = {};
    for (const def of STEMS) {
      const g = state.audioCtx.createGain();
      g.gain.value = 1;
      const an = state.audioCtx.createAnalyser();
      an.fftSize = 2048;
      g.connect(an);
      an.connect(state.masterGain);
      state.stemGains[def.id] = g;
      state.analysers[def.id] = an;
      state.muted[def.id] = false;
    }

    state.duration = audioBuffer.duration;
    state.offset = 0;
    state.mode = 'stems';
    buildStemRows(false, sep.shares);
    ui.analysisLine.classList.add('hidden');
    ui.timeTotal.textContent = fmtTime(state.duration);
    ui.seek.max = state.duration;
    state.bpm = Harmony.estimateBPM(sep.onsetEnv || [], sep.fps || 0);
    state.mc = Harmony.buildMusicalContext(Harmony.estimateKey(
      sep.chroma && sep.chroma.length === 12 ? sep.chroma : new Array(12).fill(0)
    ));
    ui.layersBlock.classList.remove('hidden');
    ui.mcInfo.textContent = 'Tonart: ' + state.mc.keyLabel + ' · Tempo: ca. ' +
      state.bpm + ' BPM (Näherung)';
    buildLayerRows();
    setStatus('Analyse fertig' + (state.trimmedNote || '') +
      ' – Instrumente über die Schaltflächen stummschalten.');
    startPlayback();
  }

  function enterFallbackMode(track) {
    state.mode = 'fallback';
    state.duration = 30;
    state.offset = 0;
    state.stemBuffers = {};
    state.muted = {};
    stopLayerScheduler();
    stopLayerNodes();
    ui.layersBlock.classList.add('hidden');
    buildStemRows(false, null);
    ui.analysisLine.classList.add('hidden');
    ui.timeTotal.textContent = '0:30';
    ui.seek.max = 30;
    setStatus('Die Preview konnte nicht für die Analyse geladen werden (CORS/Netzwerk). ' +
      'Es wird normal abgespielt, ohne Stummschaltung der Instrumente.', true);
    const audio = new Audio(track.preview);
    audio.volume = state.volume;
    state.fallbackAudio = audio;
    audio.play().catch(() => setStatus('Autoplay blockiert – Play drücken.', true));
    state.playing = true;
    ui.btnPlay.textContent = '⏸';
  }

  /* ---------- UI: Stem-Zeilen ---------- */

  function buildStemRows(pending, shares) {
    ui.stemRows.innerHTML = '';
    for (let i = 0; i < STEMS.length; i++) {
      const def = STEMS[i];
      const row = document.createElement('div');
      row.className = 'stem-row';
      row.dataset.stem = def.id;

      const icon = document.createElement('div');
      icon.className = 'stem-icon';
      icon.textContent = def.icon;

      const name = document.createElement('div');
      name.className = 'stem-name';
      name.append(def.label);
      const small = name.appendChild(document.createElement('small'));

      const meter = document.createElement('div');
      meter.className = 'meter-track';
      meter.innerHTML = '<div class="meter-fill"></div>';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mute-btn';
      btn.title = def.label + ' stummschalten (Taste ' + (i + 1) + ')';

      row.append(icon, name, meter, btn);
      ui.stemRows.appendChild(row);

      btn.addEventListener('click', () => toggleMute(def.id));
    }
    updateRows(pending ? null : (shares || {}));
  }

  function updateRows(shares) {
    for (const def of STEMS) {
      const row = ui.stemRows.querySelector('[data-stem="' + def.id + '"]');
      if (!row) continue;
      const small = row.querySelector('small');
      const btn = row.querySelector('.mute-btn');
      const fill = row.querySelector('.meter-fill');
      const muted = state.mode === 'stems' && state.muted[def.id];

      if (!shares) {
        small.textContent = state.mode === 'fallback'
          ? 'Analyse nicht möglich'
          : 'wird analysiert …';
        btn.textContent = '–';
        btn.disabled = true;
        btn.className = 'mute-btn';
      } else {
        const pct = Math.round((shares[def.id] || 0) * 100);
        small.textContent = (pct < 3 ? 'kaum vorhanden' : 'Anteil am Signal: ~' + pct + '%');
        btn.disabled = state.mode !== 'stems';
        btn.textContent = muted ? 'Stumm' : 'An';
        btn.className = 'mute-btn ' + (muted ? 'off' : 'on');
      }
      if (fill) fill.classList.toggle('muted', !!muted);
    }
  }

  function toggleMute(id) {
    if (state.mode !== 'stems') return;
    state.muted[id] = !state.muted[id];
    const g = state.stemGains[id];
    if (g) g.gain.setTargetAtTime(state.muted[id] ? 0 : 1, state.audioCtx.currentTime, 0.015);
    updateRows({});
  }

  ui.btnAll.addEventListener('click', () => {
    for (const def of STEMS) {
      if (state.muted[def.id]) toggleMute(def.id);
    }
  });

  /* ---------- Zusätzliche Instrument-Layer ---------- */

  function stopLayerScheduler() {
    if (state.layers.timer) {
      clearInterval(state.layers.timer);
      state.layers.timer = null;
    }
  }

  function stopLayerNodes() {
    for (const def of LAYERS) {
      for (const h of state.layers.handles[def.id] || []) h.stop();
      state.layers.handles[def.id] = [];
    }
  }

  function resyncLayers() {
    stopLayerScheduler();
    stopLayerNodes();
    if (state.mode !== 'stems' || !state.playing || !state.mc) return;
    const anyOn = LAYERS.some((d) => state.layers.enabled[d.id]);
    if (!anyOn) return;
    const ph = Math.max(0, state.audioCtx.currentTime - state.startedAt);
    for (const def of LAYERS) {
      if (!state.layers.enabled[def.id]) continue;
      const pat = Harmony.buildPattern(def.id, state.mc, state.bpm);
      state.layers.patterns[def.id] = pat;
      let loop = Math.floor(ph / pat.loopDur);
      const rel = ph - loop * pat.loopDur;
      let i = pat.events.findIndex((e) => e.t >= rel);
      if (i < 0) { loop++; i = 0; }
      state.layers.nextIdx[def.id] = i;
      state.layers.loop[def.id] = loop;
    }
    state.layers.timer = setInterval(layerTick, 100);
    layerTick();
  }

  function layerTick() {
    if (!state.playing || state.mode !== 'stems') return;
    const now = state.audioCtx.currentTime;
    for (const def of LAYERS) {
      if (!state.layers.enabled[def.id]) continue;
      const pat = state.layers.patterns[def.id];
      if (!pat) continue;
      let guard = 0;
      while (guard++ < 64) {
        const ev = pat.events[state.layers.nextIdx[def.id]];
        if (ev === undefined) {
          state.layers.loop[def.id] += 1;
          state.layers.nextIdx[def.id] = 0;
          continue;
        }
        const absPlayback = state.layers.loop[def.id] * pat.loopDur + ev.t;
        if (absPlayback >= state.duration) break;
        const absCtx = state.startedAt + absPlayback;
        if (absCtx > now + 0.3) break;
        if (absCtx >= now - 0.05) {
          try {
            const handle = SynthVoices[def.id](state.audioCtx, state.layers.gains[def.id],
              Math.max(absCtx, now + 0.01),
              { freq: ev.notes && ev.notes.length ? ev.notes[0] : state.mc.rootFreq,
                notes: ev.notes || [state.mc.rootFreq],
                dur: ev.dur, vel: ev.vel, det: ev.det });
            state.layers.handles[def.id].push(handle);
          } catch (e) {
            console.warn('Layer-Voice ' + def.id + ' Fehler:', e);
          }
        }
        state.layers.nextIdx[def.id] += 1;
      }
    }
  }

  function buildLayerRows() {
    ui.layerRows.innerHTML = '';
    ensureAudioCtx();
    for (const def of LAYERS) {
      if (!state.layers.gains[def.id]) {
        const g = state.audioCtx.createGain();
        g.gain.value = def.gain;
        const an = state.audioCtx.createAnalyser();
        an.fftSize = 2048;
        g.connect(an);
        an.connect(state.masterGain);
        state.layers.gains[def.id] = g;
        state.layers.analysers[def.id] = an;
      }
      if (state.layers.handles[def.id] === undefined) state.layers.handles[def.id] = [];
      const row = document.createElement('div');
      row.className = 'stem-row';
      row.dataset.stem = def.id;
      const icon = document.createElement('div');
      icon.className = 'stem-icon';
      icon.textContent = def.icon;
      const name = document.createElement('div');
      name.className = 'stem-name';
      name.append(def.label);
      name.appendChild(document.createElement('small')).textContent = 'harmonisch ergänzt';
      const meter = document.createElement('div');
      meter.className = 'meter-track';
      meter.innerHTML = '<div class="meter-fill" style="width:0%"></div>';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle-btn off';
      btn.textContent = 'Aus';
      btn.title = def.label + ' dazumischen';
      row.append(icon, name, meter, btn);
      ui.layerRows.appendChild(row);
      btn.addEventListener('click', () => toggleLayer(def.id));
    }
    refreshLayerRows();
  }

  function refreshLayerRows() {
    for (const def of LAYERS) {
      const row = ui.layerRows.querySelector('[data-stem="' + def.id + '"]');
      if (!row) continue;
      const btn = row.querySelector('.toggle-btn');
      const on = !!state.layers.enabled[def.id];
      btn.textContent = on ? 'Ein' : 'Aus';
      btn.className = 'toggle-btn ' + (on ? 'on' : 'off');
    }
  }

  function toggleLayer(id) {
    if (state.mode !== 'stems') return;
    ensureAudioCtx();
    if (!state.playing) { startPlayback(); }
    state.layers.enabled[id] = !state.layers.enabled[id];
    if (!state.layers.enabled[id]) {
      for (const h of state.layers.handles[id] || []) h.stop();
      state.layers.handles[id] = [];
    }
    refreshLayerRows();
    resyncLayers();
  }

  /* ---------- Transport ---------- */

  function currentTime() {
    if (state.mode === 'fallback' && state.fallbackAudio) return state.fallbackAudio.currentTime;
    if (state.playing) return state.audioCtx.currentTime - state.startedAt;
    return state.offset;
  }

  function stopSources() {
    for (const s of state.sources) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} }
    state.sources = [];
  }

  function stopPlayback() {
    state.playing = false;
    stopSources();
    stopLayerScheduler();
    stopLayerNodes();
    if (state.fallbackAudio) { state.fallbackAudio.pause(); }
    ui.btnPlay.textContent = '▶';
    cancelAnimationFrame(state.rafId);
  }

  function startPlayback() {
    if (state.mode === 'fallback') {
      if (state.fallbackAudio) state.fallbackAudio.play().catch(() => {});
      state.playing = true;
      ui.btnPlay.textContent = '⏸';
      return;
    }
    if (state.mode !== 'stems') return;
    ensureAudioCtx();
    stopSources();
    const now = state.audioCtx.currentTime;
    const offset = Math.min(state.offset, Math.max(0, state.duration - 0.05));
    for (const def of STEMS) {
      const src = state.audioCtx.createBufferSource();
      src.buffer = state.stemBuffers[def.id];
      src.connect(state.stemGains[def.id]);
      src.start(0, offset);
      state.sources.push(src);
    }
    state.startedAt = now - offset;
    state.playing = true;
    ui.btnPlay.textContent = '⌛';
    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(raf);
    resyncLayers();
  }

  function seekTo(t) {
    t = Math.min(Math.max(0, t), state.duration || 0);
    state.offset = t;
    if (state.mode === 'fallback' && state.fallbackAudio) state.fallbackAudio.currentTime = t;
    if (state.playing) startPlayback();
    updateTimeDisplay();
  }

  function updateTimeDisplay() {
    const t = currentTime();
    if (document.activeElement !== ui.seek) ui.seek.value = t;
    ui.timeCur.textContent = fmtTime(t);
  }

  function raf() {
    if (state.playing || state.mode === 'fallback') {
      const t = currentTime();
      if (state.duration && t >= state.duration - 0.02) {
        stopPlayback();
        state.offset = 0;
        updateTimeDisplay();
        ui.seek.value = 0;
        return;
      }
      updateTimeDisplay();
      drawMeters();
      state.rafId = requestAnimationFrame(raf);
    }
  }

  function drawMeters() {
    if (state.mode !== 'stems') return;
    for (const def of STEMS) {
      const an = state.analysers[def.id];
      const row = ui.stemRows.querySelector('[data-stem="' + def.id + '"] .meter-fill');
      if (!an || !row) continue;
      an.getByteTimeDomainData(state.meterData);
      let sum = 0;
      for (let i = 0; i < state.meterData.length; i++) {
        const v = (state.meterData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / state.meterData.length);
      row.style.width = Math.min(100, rms * 320) + '%';
    }
    for (const def of LAYERS) {
      const an = state.layers.analysers[def.id];
      const row = ui.layerRows.querySelector('[data-stem="' + def.id + '"] .meter-fill');
      if (!an || !row) continue;
      an.getByteTimeDomainData(state.meterData);
      let sum = 0;
      for (let i = 0; i < state.meterData.length; i++) {
        const v = (state.meterData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / state.meterData.length);
      row.style.width = Math.min(100, rms * 500) + '%';
    }
  }

  ui.btnPlay.addEventListener('click', () => {
    ensureAudioCtx();
    if (state.playing) {
      state.offset = currentTime();
      stopPlayback();
    } else {
      if (state.offset >= (state.duration || 0) - 0.05) state.offset = 0;
      startPlayback();
      state.rafId = requestAnimationFrame(raf);
    }
  });

  ui.seek.addEventListener('input', () => {
    seekTo(parseFloat(ui.seek.value));
  });

  ui.volume.addEventListener('input', () => {
    state.volume = parseFloat(ui.volume.value);
    if (state.masterGain && state.audioCtx) {
      state.masterGain.gain.setTargetAtTime(state.volume, state.audioCtx.currentTime, 0.02);
    }
    if (state.fallbackAudio) state.fallbackAudio.volume = state.volume;
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type="search"]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      ui.btnPlay.click();
    } else if (e.key >= '1' && e.key <= '4') {
      toggleMute(STEMS[parseInt(e.key, 10) - 1].id);
    }
  });

  /* ---------- Suche ---------- */

  const placeholders = {
    deezer: 'Song, Künstler oder Album suchen …',
    audius: 'Audius durchsuchen – freie Musik in voller Länge …',
  };

  function doSearch(q) {
    ui.searchBtn.disabled = true;
    setStatus('Suche auf ' + (state.source === 'audius' ? 'Audius' : 'Deezer') + ' nach „' + q + '" …');
    ui.results.innerHTML = '';
    ui.player.classList.add('hidden');
    const p = state.source === 'audius'
      ? searchAudius(q)
      : searchDeezer(q).then(normalizeDeezerTracks);
    p.then((list) => renderResults(list))
      .catch((e) => setStatus('Suche fehlgeschlagen: ' + e.message, true))
      .finally(() => { ui.searchBtn.disabled = false; });
  }

  ui.srcBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.source === btn.dataset.src) return;
      state.source = btn.dataset.src;
      ui.srcBtns.forEach((b) => b.classList.toggle('active', b === btn));
      ui.input.placeholder = placeholders[state.source];
      ui.results.innerHTML = '';
      ui.player.classList.add('hidden');
      setStatus(state.source === 'audius'
        ? 'Audius: freie Musik in voller Länge (Analyse der ersten 3 Minuten).'
        : 'Deezer: riesiger Katalog als 30-Sekunden-Previews.');
    });
  });

  ui.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = ui.input.value.trim();
    if (q) doSearch(q);
  });

  const suggestions = ['Daft Punk', 'Billie Eilish', 'Queen', 'Miles Davis', 'Michael Jackson', 'Rammstein'];
  for (const s of suggestions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = s;
    chip.addEventListener('click', () => { ui.input.value = s; doSearch(s); });
    ui.suggestions.appendChild(chip);
  }
})();
