const { separateStems, makeFFT } = require('../separate.js');

const failures = [];
function approx(actual, expected, tol, msg) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) console.log(`ok   ${msg}: ${actual}`);
  else failures.push(new Error(`FAIL ${msg}: got ${actual}, expected ${expected} (tol ${tol})`));
  return ok;
}
function check(cond, okMsg, failMsg) {
  if (cond) console.log(`ok   ${okMsg}`);
  else failures.push(new Error(`FAIL ${failMsg}`));
}

function main() {
  const N = 8;
  const fft = makeFFT(N);
  let re = new Float64Array([1, 0, 1, 0, 1, 0, 1, 0]);
  let im = new Float64Array(N);
  fft.transform(re, im, false);
  approx(re[4] / N, 0.5, 1e-9, 'FFT DFT[4].re/N');
  approx(im[4], 0, 1e-9, 'FFT DFT[4].im');
  fft.transform(re, im, true);
  approx(re[4] / N, 1, 1e-9, 'IFFT roundtrip (scaled)');

  const sr = 44100;
  const len = sr * 3;
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const bass = 0.5 * Math.sin(2 * Math.PI * 80 * t);
    const tone = 0.3 * Math.sin(2 * Math.PI * 500 * t);
    const click = Math.random() < 0.005 ? (Math.random() * 2 - 1) * 2.5 : 0;
    const hi = 0.05 * Math.sin(2 * Math.PI * 8000 * t);
    L[i] = bass + tone * 0.9 + click + hi;
    R[i] = bass + tone * 1.1 - click * 0.5 + hi;
  }
  const buf = {
    sampleRate: sr,
    length: len,
    numberOfChannels: 2,
    getChannelData: (c) => (c === 0 ? L : R),
  };

  separateStems(buf, () => {}).then((res) => {
    const ids = ['drums', 'bass', 'vocals', 'other'];
    let sumE = 0;
    let maxAmp = 0;
    for (const id of ids) {
      const s = res.stems[id];
      for (let i = 0; i < len; i++) {
        if (!isFinite(s.L[i]) || !isFinite(s.R[i])) failures.push(new Error(`FAIL NaN/Inf in stem ${id} @${i}`));
        maxAmp = Math.max(maxAmp, Math.abs(s.L[i]), Math.abs(s.R[i]));
      }
      sumE += res.shares[id];
    }
    approx(sumE, 1, 1e-9, 'shares sum to 1');
    check(maxAmp < 2.75, `max stem amplitude sane (${maxAmp.toFixed(3)})`, `max stem amplitude ${maxAmp}`);

    let rec = new Float32Array(len), rec2 = new Float32Array(len);
    for (const id of ids) for (let i = 0; i < len; i++) { rec[i] += res.stems[id].L[i]; rec2[i] += res.stems[id].R[i]; }
    let err = 0, ref = 0;
    for (let i = 0; i < len; i++) { err += (rec[i] - L[i]) ** 2; ref += L[i] ** 2; }
    approx(err / (ref + 1e-12), 0, 5e-3, 'relative reconstruction error (L)');
    err = 0; ref = 0;
    for (let i = 0; i < len; i++) { err += (rec2[i] - R[i]) ** 2; ref += R[i] ** 2; }
    approx(err / (ref + 1e-12), 0, 5e-3, 'relative reconstruction error (R)');

    const sh = res.shares;
    console.log('shares:', Object.fromEntries(ids.map((k) => [k, sh[k].toFixed(3)])));
    check(sh.bass > 0.25 && sh.bass > sh.drums, 'bass dominance', 'bass should dominate');
    check(sh.other > 0.02, 'other captured the 8kHz tone', 'other should capture 8kHz tone');
    check(sh.vocals > 0.1, 'vocals captured the 500Hz mid tone', 'vocals should capture mid tone');

    for (const f of failures) console.error(f.message);
    if (failures.length) {
      console.error(`${failures.length} test(s) FAILED`);
      process.exit(1);
    } else {
      console.log('ALL TESTS PASSED');
      process.exit(0);
    }
  });
}

main();
