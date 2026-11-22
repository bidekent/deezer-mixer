/* Synthetisierte Instrumenten-Stimmen (Web Audio, keine Samples).
   Jede Voice-Funktion bekommt (ctx, dest, t, opts) und gibt {stop()} zurück,
   um beim Pausieren alle gestarteten Knoten sofort zu beenden. */
(function (global) {
  'use strict';

  function noiseBuffer(ctx) {
    if (!ctx.__dzNoise) {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      ctx.__dzNoise = b;
    }
    return ctx.__dzNoise;
  }

  function makeHandle(ctx, nodes) {
    return {
      stop() {
        for (const n of nodes) {
          try { if (n.stop) n.stop(0); } catch (e) {}
          try { n.disconnect(); } catch (e) {}
        }
        nodes.length = 0;
      },
    };
  }

  function vibrato(ctx, osc, freq, rate, depthHz, t, dur) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = rate;
    const amt = ctx.createGain();
    amt.gain.setValueAtTime(0, t);
    amt.gain.linearRampToValueAtTime(depthHz, t + Math.min(0.4, dur * 0.4));
    lfo.connect(amt);
    amt.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.3);
    return [lfo, amt];
  }

  const voices = {
    sax(ctx, dest, t, o) {
      const dur = o.dur + 0.18;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(o.freq * 0.97, t);
      osc.frequency.exponentialRampToValueAtTime(o.freq, t + 0.05);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(o.freq * 5 + 400, 3800);
      lp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.vel, t + 0.07);
      g.gain.setValueAtTime(o.vel, t + o.dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const breath = ctx.createBufferSource();
      breath.buffer = noiseBuffer(ctx);
      breath.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(o.freq * 2.5, 3200);
      bp.Q.value = 0.8;
      const bg = ctx.createGain();
      bg.gain.value = o.vel * 0.25;
      osc.connect(lp); lp.connect(g); g.connect(dest);
      breath.connect(bp); bp.connect(bg); bg.connect(dest);
      osc.start(t); osc.stop(t + dur + 0.05);
      breath.start(t); breath.stop(t + dur + 0.05);
      return makeHandle(ctx, [osc, lp, g, breath, bp, bg, ...vibrato(ctx, osc, o.freq, 4.6, o.freq * 0.007, t, o.dur)]);
    },

    kalimba(ctx, dest, t, o) {
      const dur = Math.max(0.9, o.dur);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(o.freq, t);
      const part = ctx.createOscillator();
      part.type = 'sine';
      part.frequency.setValueAtTime(o.freq * 5.4, t);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(o.vel * 0.18, t);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.vel, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); part.connect(pg); pg.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + dur + 0.05);
      part.start(t); part.stop(t + 0.1);
      return makeHandle(ctx, [osc, part, pg, g]);
    },

    violin(ctx, dest, t, o) {
      const dur = o.dur + 0.4;
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = o.freq;
      o1.detune.value = -6;
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.value = o.freq;
      o2.detune.value = 6;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(o.freq * 4 + 600, 3200);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.vel, t + 0.3);
      g.gain.setValueAtTime(o.vel, t + o.dur * 0.75);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const vib = vibrato(ctx, o1, o.freq, 5.5, o.freq * 0.006, t, o.dur);
      const vib2 = vibrato(ctx, o2, o.freq, 5.5, o.freq * 0.006, t, o.dur);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
      o1.start(t); o1.stop(t + dur + 0.05);
      o2.start(t); o2.stop(t + dur + 0.05);
      return makeHandle(ctx, [o1, o2, lp, g, ...vib, ...vib2]);
    },

    accordion(ctx, dest, t, o) {
      const dur = o.dur + 0.15;
      const oscs = [];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.vel * 0.25, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const trem = ctx.createOscillator();
      trem.type = 'sine';
      trem.frequency.value = 5.2;
      const tg = ctx.createGain();
      tg.gain.value = 0.04;
      trem.connect(tg); tg.connect(g.gain);
      trem.start(t); trem.stop(t + dur + 0.05);
      for (const f of o.notes || []) {
        const a = ctx.createOscillator();
        a.type = 'sawtooth';
        a.frequency.value = f;
        a.detune.value = -8;
        const b = ctx.createOscillator();
        b.type = 'sawtooth';
        b.frequency.value = f;
        b.detune.value = 8;
        const sub = ctx.createOscillator();
        sub.type = 'square';
        sub.frequency.value = f / 2;
        const sg = ctx.createGain();
        sg.gain.value = 0.35;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        a.connect(lp); b.connect(lp); sub.connect(sg); sg.connect(lp); lp.connect(g);
        a.start(t); a.stop(t + dur + 0.05);
        b.start(t); b.stop(t + dur + 0.05);
        sub.start(t); sub.stop(t + dur + 0.05);
        oscs.push(a, b, sub, sg, lp);
      }
      g.connect(dest);
      return makeHandle(ctx, [g, trem, tg, ...oscs]);
    },

    coconut(ctx, dest, t, o) {
      const det = o.det || 0;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + det * 160 + Math.random() * 250;
      bp.Q.value = 5;
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(o.vel * 0.25, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      n.connect(bp); bp.connect(ng); ng.connect(dest);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(210 + det * 30, t);
      osc.frequency.exponentialRampToValueAtTime(120 + det * 20, t + 0.06);
      const og = ctx.createGain();
      og.gain.setValueAtTime(o.vel * 0.25, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      osc.connect(og); og.connect(dest);
      n.start(t); n.stop(t + 0.08);
      osc.start(t); osc.stop(t + 0.09);
      return makeHandle(ctx, [n, bp, ng, osc, og]);
    },

    dog(ctx, dest, t, o) {
      const det = o.det || 0;
      const base = o.freq * Math.pow(2, det / 12);
      const dur = Math.max(0.16, o.dur);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * 1.35, t);
      osc.frequency.exponentialRampToValueAtTime(base * 0.75, t + dur * 0.75);
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = base * 1.6;
      bp.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(o.vel * 0.25, t + 0.02);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(o.vel * 0.5, t + 0.015);
      g.gain.linearRampToValueAtTime(o.vel * 0.25, t + 0.07);
      g.gain.linearRampToValueAtTime(o.vel * 0.45, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.setValueAtTime(base * 0.25, t);
      const o2g = ctx.createGain();
      o2g.gain.value = 0.5;
      o2.connect(o2g); o2g.connect(g); o2.start(t); o2.stop(t + dur + 0.05);
      osc.connect(lp); lp.connect(g); g.connect(dest);
      n.connect(bp); bp.connect(ng); ng.connect(lp);
      osc.start(t); osc.stop(t + dur + 0.05);
      n.start(t); n.stop(t + dur + 0.05);
      return makeHandle(ctx, [osc, lp, g, n, bp, ng, o2, o2g]);
    },
  };

  global.SynthVoices = voices;
  if (typeof module !== 'undefined' && module.exports) module.exports = voices;
})(typeof window !== 'undefined' ? window : globalThis);
