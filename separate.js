/* In-Browser Stem-Separation (STFT + Harmonic/Percussive Source Separation).
   DOM-frei, damit es auch in Node getestet werden kann. */
(function (global) {
  'use strict';

  function makeFFT(n) {
    const levels = Math.floor(Math.log2(n));
    if (1 << levels !== n) throw new Error('FFT-Groesse muss 2er-Potenz sein');
    const cosTable = new Float64Array(n / 2);
    const sinTable = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cosTable[i] = Math.cos((2 * Math.PI * i) / n);
      sinTable[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let j = 0; j < levels; j++) r = (r << 1) | ((i >>> j) & 1);
      rev[i] = r;
    }
    function transform(re, im, inverse) {
      const nn = re.length;
      for (let i = 0; i < nn; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      const s = inverse ? -1 : 1;
      for (let size = 2; size <= nn; size <<= 1) {
        const half = size >> 1;
        const step = nn / size;
        for (let i = 0; i < nn; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const c = cosTable[k], sn = sinTable[k] * s;
            const tre = re[l] * c + im[l] * sn;
            const tim = im[l] * c - re[l] * sn;
            re[l] = re[j] - tre; im[l] = im[j] - tim;
            re[j] += tre; im[j] += tim;
          }
        }
      }
    }
    return { transform, size: n };
  }

  function removeValue(win, v) {
    for (let i = 0; i < win.length; i++) {
      if (win[i] === v) {
        for (let j = i; j < win.length - 1; j++) win[j] = win[j + 1];
        return;
      }
    }
    let maxI = 0;
    for (let i = 1; i < win.length; i++) if (win[i] > win[maxI]) maxI = i;
    for (let j = maxI; j < win.length - 1; j++) win[j] = win[j + 1];
  }

  function insertValue(win, v) {
    let i = win.length - 1;
    while (i > 0 && win[i - 1] > v) {
      win[i] = win[i - 1];
      i--;
    }
    win[i] = v;
  }

  function medianFilterFreq(mag, nFrames, nBins, k) {
    const out = new Float32Array(mag.length);
    const h = k >> 1;
    const win = new Float64Array(k);
    for (let f = 0; f < nFrames; f++) {
      const base = f * nBins;
      for (let j = 0; j < k; j++) {
        let b = j - h;
        b = b < 0 ? 0 : (b >= nBins ? nBins - 1 : b);
        win[j] = mag[base + b];
      }
      win.sort();
      for (let b = 0; b < nBins; b++) {
        out[base + b] = win[h];
        const oIdx = b - h, iIdx = b + h + 1;
        const vOut = mag[base + (oIdx < 0 ? 0 : (oIdx >= nBins ? nBins - 1 : oIdx))];
        const vIn = iIdx >= nBins ? mag[base + nBins - 1] : mag[base + iIdx];
        removeValue(win, vOut);
        insertValue(win, vIn);
      }
    }
    return out;
  }

  function medianFilterTime(mag, nFrames, nBins, k) {
    const out = new Float32Array(mag.length);
    const h = k >> 1;
    const win = new Float64Array(k);
    for (let b = 0; b < nBins; b++) {
      for (let j = 0; j < k; j++) {
        let f = j - h;
        f = f < 0 ? 0 : (f >= nFrames ? nFrames - 1 : f);
        win[j] = mag[f * nBins + b];
      }
      win.sort();
      for (let f = 0; f < nFrames; f++) {
        out[f * nBins + b] = win[h];
        const oIdx = f - h, iIdx = f + h + 1;
        const vOut = mag[(oIdx < 0 ? 0 : (oIdx >= nFrames ? nFrames - 1 : oIdx)) * nBins + b];
        const vIn = mag[(iIdx >= nFrames ? nFrames - 1 : iIdx) * nBins + b];
        removeValue(win, vOut);
        insertValue(win, vIn);
      }
    }
    return out;
  }

  function smoothRamp(x, a, b) {
    if (x <= a) return 0;
    if (x >= b) return 1;
    const t = (x - a) / (b - a);
    return t * t * (3 - 2 * t);
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  /* Trennt ein Stereo-Signal in 4 Pseudo-Stems: drums, bass, vocals, other.
     Rueckgabe: { stems: {id: {L, R}}, shares: {id: 0..1}, sampleRate } */
  async function separateStems(audioBuffer, onProgress) {
    const sr = audioBuffer.sampleRate;
    const L = audioBuffer.getChannelData(0);
    const R = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : L;
    const len = audioBuffer.length;

    const N = 2048, hop = 512;
    const bins = N / 2 + 1;
    const nFrames = Math.ceil(len / hop) + 1;
    const fft = makeFFT(N);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));

    const report = onProgress || (() => {});
    report(5, 'Fensterspektren werden berechnet ...');
    await tick();

    const reL = new Float32Array(nFrames * bins);
    const imL = new Float32Array(nFrames * bins);
    const reR = new Float32Array(nFrames * bins);
    const imR = new Float32Array(nFrames * bins);
    const frameRe = new Float32Array(N);
    const frameIm = new Float32Array(N);

    for (let ch = 0; ch < 2; ch++) {
      const src = ch === 0 ? L : R;
      const outRe = ch === 0 ? reL : reR;
      const outIm = ch === 0 ? imL : imR;
      for (let f = 0; f < nFrames; f++) {
        const off = f * hop;
        for (let i = 0; i < N; i++) {
          const s = off + i < len ? src[off + i] : 0;
          frameRe[i] = s * win[i];
          frameIm[i] = 0;
        }
        fft.transform(frameRe, frameIm, false);
        const base = f * bins;
        for (let b = 0; b < bins; b++) {
          outRe[base + b] = frameRe[b];
          outIm[base + b] = frameIm[b];
        }
        if ((f & 127) === 0) {
          report(5 + 25 * ((ch * nFrames + f) / (2 * nFrames)));
          await tick();
        }
      }
    }

    report(32, 'Harmonic/Percussive-Trennung ...');
    await tick();
    const mag = new Float32Array(nFrames * bins);
    for (let i = 0; i < mag.length; i++) {
      mag[i] = (Math.sqrt(reL[i] * reL[i] + imL[i] * imL[i]) +
        Math.sqrt(reR[i] * reR[i] + imR[i] * imR[i])) * 0.5;
    }
    const harm = medianFilterTime(mag, nFrames, bins, 17);
    report(42, 'Harmonic/Percussive-Trennung ...');
    await tick();
    const perc = medianFilterFreq(mag, nFrames, bins, 17);

    const mH = new Float32Array(mag.length);
    for (let i = 0; i < mH.length; i++) {
      const hs = harm[i] * harm[i], ps = perc[i] * perc[i];
      mH[i] = hs / (hs + ps + 1e-12);
    }
    report(50, 'Stems werden synthetisiert ...');
    await tick();

    const binHz = sr / N;
    const bassMask = new Float32Array(bins);
    const vocMask = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const f = b * binHz;
      bassMask[b] = smoothRamp(f, 40, 90) * (1 - smoothRamp(f, 280, 430));
      vocMask[b] = smoothRamp(f, 180, 340) * (1 - smoothRamp(f, 4800, 6800));
    }

    const stemIds = ['drums', 'bass', 'vocals', 'other'];
    const outLen = len + N;
    const outs = {};
    for (const id of stemIds) outs[id] = { L: new Float32Array(outLen), R: new Float32Array(outLen) };
    const norm = new Float32Array(outLen);

    const spec = {};
    for (const id of stemIds) {
      spec[id] = {
        Lre: new Float32Array(N), Lim: new Float32Array(N),
        Rre: new Float32Array(N), Rim: new Float32Array(N),
      };
    }

    for (let f = 0; f < nFrames; f++) {
      const base = f * bins;
      const off = f * hop;
      for (const id of stemIds) {
        spec[id].Lre.fill(0); spec[id].Lim.fill(0);
        spec[id].Rre.fill(0); spec[id].Rim.fill(0);
      }
      for (let b = 0; b < bins; b++) {
        const mP = 1 - mH[base + b];
        const hb = mH[base + b];
        const bm = hb * bassMask[b];
        const vm = hb * vocMask[b];
        const lRe = reL[base + b], lIm = imL[base + b];
        const rRe = reR[base + b], rIm = imR[base + b];
        const mRe = (lRe + rRe) * 0.5, mIm = (lIm + rIm) * 0.5;

        spec.drums.Lre[b] = mP * lRe; spec.drums.Lim[b] = mP * lIm;
        spec.drums.Rre[b] = mP * rRe; spec.drums.Rim[b] = mP * rIm;
        spec.bass.Lre[b] = bm * mRe; spec.bass.Lim[b] = bm * mIm;
        spec.bass.Rre[b] = bm * mRe; spec.bass.Rim[b] = bm * mIm;
        spec.vocals.Lre[b] = vm * mRe; spec.vocals.Lim[b] = vm * mIm;
        spec.vocals.Rre[b] = vm * mRe; spec.vocals.Rim[b] = vm * mIm;
        spec.other.Lre[b] = lRe - spec.drums.Lre[b] - spec.bass.Lre[b] - spec.vocals.Lre[b];
        spec.other.Lim[b] = lIm - spec.drums.Lim[b] - spec.bass.Lim[b] - spec.vocals.Lim[b];
        spec.other.Rre[b] = rRe - spec.drums.Rre[b] - spec.bass.Rre[b] - spec.vocals.Rre[b];
        spec.other.Rim[b] = rIm - spec.drums.Rim[b] - spec.bass.Rim[b] - spec.vocals.Rim[b];
      }
      let first = true;
      for (const id of stemIds) {
        for (let ch = 0; ch < 2; ch++) {
          const sre = ch === 0 ? spec[id].Lre : spec[id].Rre;
          const sim = ch === 0 ? spec[id].Lim : spec[id].Rim;
          for (let b = 1; b < bins; b++) {
            sre[N - b] = sre[b];
            sim[N - b] = -sim[b];
          }
          fft.transform(sre, sim, true);
          const out = ch === 0 ? outs[id].L : outs[id].R;
          const inv = 1 / N;
          for (let i = 0; i < N; i++) {
            const idx = off + i;
            out[idx] += sre[i] * win[i] * inv;
            if (first && ch === 0) norm[idx] += win[i] * win[i];
          }
        }
        first = false;
      }
      if ((f & 31) === 0) {
        report(50 + 45 * (f / nFrames));
        await tick();
      }
    }

    for (let i = 0; i < len; i++) {
      const n = norm[i];
      if (n > 0.1) {
        const g = 1 / n;
        for (const id of stemIds) {
          outs[id].L[i] *= g;
          outs[id].R[i] *= g;
        }
      }
    }

    report(97, 'Berechnung der Stems ...');
    await tick();
    const stems = {};
    const shares = {};
    let total = 0;
    const energies = {};
    for (const id of stemIds) {
      let e = 0;
      const oL = outs[id].L, oR = outs[id].R;
      for (let i = 0; i < len; i++) e += oL[i] * oL[i] + oR[i] * oR[i];
      energies[id] = e;
      total += e;
    }
    if (total <= 0) total = 1;
    for (const id of stemIds) {
      shares[id] = energies[id] / total;
      stems[id] = { L: outs[id].L.subarray(0, len), R: outs[id].R.subarray(0, len) };
    }
    report(100, 'Fertig');
    return { stems, shares, sampleRate: sr };
  }

  const api = { makeFFT, separateStems };
  global.StemSeparation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
