/* Harmonie-Erkennung und Muster-Erzeugung für die zusätzlichen Instrumente.
   DOM-frei, node-testbar. */
(function (global) {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function pearson(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return num / (Math.sqrt(da * db) + 1e-12);
  }

  function estimateKey(chroma) {
    let best = { score: -2, tonic: 0, mode: 'Dur' };
    for (let t = 0; t < 12; t++) {
      const rotated = [];
      for (let i = 0; i < 12; i++) rotated.push(chroma[(i + t) % 12]);
      const sMaj = pearson(rotated, MAJOR_PROFILE);
      if (sMaj > best.score) best = { score: sMaj, tonic: t, mode: 'Dur' };
      const sMin = pearson(rotated, MINOR_PROFILE);
      if (sMin > best.score) best = { score: sMin, tonic: t, mode: 'Moll' };
    }
    return best;
  }

  function estimateBPM(onsetEnv, fps) {
    const n = onsetEnv.length;
    if (!n || !fps) return 120;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += onsetEnv[i];
    mean /= n;
    const rect = new Float32Array(n);
    for (let i = 0; i < n; i++) rect[i] = Math.max(0, onsetEnv[i] - mean);

    const minLag = Math.max(2, Math.floor((60 * fps) / 190));
    const maxLag = Math.ceil((60 * fps) / 60);
    let best = { score: -1, bpm: 120 };
    for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += rect[i] * rect[i + lag];
      s /= (n - lag);
      if (s > best.score) best = { score: s, bpm: (60 * fps) / lag };
    }
    if (!isFinite(best.bpm) || best.bpm <= 0) return 120;
    return Math.round(best.bpm);
  }

  /* Musikalischer Kontext: Tonleiter, Akkorde (Wechsel alle 2 Takte), Frequenz-Helfer */
  function buildMusicalContext(keyResult) {
    const tonicPc = keyResult.tonic;
    const steps = keyResult.mode === 'Dur' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
    const rootFreq = 440 * Math.pow(2, (tonicPc - 9) / 12);
    const degFreq = (deg, octShift) => {
      const oct = Math.floor(deg / 7);
      const idx = ((deg % 7) + 7) % 7;
      return rootFreq * Math.pow(2, oct + steps[idx] / 12 + (octShift || 0));
    };
    const chordDegrees = [0, 3, 4, 5];
    const chords = chordDegrees.map((d) => [0, 2, 4].map((o) => degFreq(d + o)));
    const chordForBar = (bar) => chords[Math.floor((((bar % 8) + 8) % 8) / 2) % 4];
    return {
      tonicPc,
      mode: keyResult.mode,
      keyLabel: NOTE_NAMES[tonicPc] + '-' + keyResult.mode,
      steps,
      rootFreq,
      degFreq,
      chords,
      chordForBar,
    };
  }

  /* Erzeugt pro Layer eine Gruppe von Events über 8 Takte (Loop).
     Event: { t: Sekunden im Loop, notes: [Hz] (null = perkussiv), dur: s, vel: 0..1, det: Quintenschift } */
  function buildPattern(layerId, mc, bpm) {
    const spb = 60 / bpm;
    const loopBars = 8;
    const loopDur = 4 * spb * loopBars;
    const events = [];
    const push = (beat, notes, durBeats, vel, det) =>
      events.push({ t: beat * spb, notes, dur: durBeats * spb, vel, det: det || 0 });

    if (layerId === 'sax') {
      const motif = [4, 6, 5, 3];
      for (let b = 1; b < loopBars; b += 2) {
        for (let k = 0; k < 4; k++) {
          const deg = ((motif[k] + b) % 9) + 2;
          push(b * 4 + k, [mc.degFreq(deg, 1)], k === 0 ? 1.5 : 0.75, 0.5);
        }
      }
    } else if (layerId === 'kalimba') {
      for (let b = 0; b < loopBars; b++) {
        const ch = mc.chordForBar(b);
        const arp = [ch[0] * 2, ch[2] * 2, ch[1] * 2, ch[2] * 4, ch[0] * 4, ch[2] * 2];
        for (let e = 0; e < 8; e++) {
          if (e % 2 === 1 && b % 2 === 1) continue;
          push(b * 4 + e * 0.5, [arp[e % arp.length]], 0.9, 0.34);
        }
      }
    } else if (layerId === 'violin') {
      for (let b = 0; b < loopBars; b += 2) {
        const ch = mc.chordForBar(b);
        push(b * 4, [ch[1] * 2], 8, 0.26);
        push(b * 4 + 2, [ch[2] * 2], 6, 0.2);
      }
    } else if (layerId === 'accordion') {
      for (let b = 0; b < loopBars; b++) {
        const ch = mc.chordForBar(b);
        push(b * 4, [ch[0] / 2], 0.8, 0.34);
        push(b * 4 + 1, ch, 0.6, 0.26);
        push(b * 4 + 2, [ch[0] / 2], 0.8, 0.34);
        push(b * 4 + 3, ch, 0.6, 0.26);
      }
    } else if (layerId === 'coconut') {
      const offs = [0, 3, 6, 10, 12, 14];
      for (let b = 0; b < loopBars; b++) {
        for (let k = 0; k < offs.length; k++) {
          const acc = offs[k] % 6 === 0;
          push(b * 4 + offs[k] / 4, null, 0.15, acc ? 0.5 : 0.32, acc ? 0 : 2);
        }
      }
    } else if (layerId === 'dog') {
      push(2 * 4 + 2, null, 0.34, 0.5, 0);
      push(6 * 4 + 2, null, 0.34, 0.5, 0);
      push(6 * 4 + 2.75, null, 0.22, 0.4, -2);
      push(7 * 4 + 3, null, 0.34, 0.5, 3);
    }
    return { events, loopDur };
  }

  const api = { estimateKey, estimateBPM, buildMusicalContext, buildPattern, NOTE_NAMES };
  global.Harmony = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
