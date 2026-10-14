// All sounds are synthesized with Web Audio — no audio files to download.
let ctx = null;
let master = null;
let noise = null;

export const Sound = {
  enabled: true,

  // iOS only allows audio to start from inside a user gesture.
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.8;
        master.connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 0.4);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch {
      /* no audio — the game works fine without it */
    }
  },

  play(name, opt = {}) {
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + (opt.delay || 0);
    const vol = opt.vol ?? 1;
    switch (name) {
      case 'pick':
        burst(t, 1800, 1, 0.04, 0.15 * vol);
        break;
      case 'step':
        // soft hoof on grass
        burst(t, 600 + Math.random() * 200, 1.4, 0.05, 0.12 * vol);
        break;
      case 'bump':
        burst(t, 300, 0.8, 0.08, 0.25 * vol);
        tone(t, 160, 0.1, 0.1 * vol, 'sine', 110);
        break;
      case 'baa':
        baa(t, opt.pitch || 1, 0.32 * vol);
        break;
      case 'close':
        [0, 4, 7, 12].forEach((s, i) => tone(t + i * 0.07, 587.33 * 2 ** (s / 12), 0.4, 0.09 * vol, 'triangle'));
        break;
      case 'undo':
        burst(t, 700, 0.7, 0.08, 0.22 * vol);
        break;
      case 'hint':
        tone(t, 880, 0.25, 0.08 * vol, 'triangle');
        tone(t + 0.08, 1318.5, 0.3, 0.06 * vol, 'triangle');
        break;
      case 'win':
        [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(t + i * 0.09, 523.25 * 2 ** (s / 12), 0.6, 0.12 * vol, 'triangle'));
        baa(t + 0.75, 1.15, 0.25 * vol);
        break;
    }
  },
};

// A little "mæh": a buzzy tone with a fast wobble, filtered to sound like a voice.
function baa(t, pitch, gain) {
  const dur = 0.42;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f0 = 330 * pitch;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f0 * 1.06, t + 0.08);
  o.frequency.linearRampToValueAtTime(f0 * 0.92, t + dur);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 22;
  const depth = ctx.createGain();
  depth.gain.value = f0 * 0.05;
  lfo.connect(depth).connect(o.frequency);
  const formant = ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.frequency.value = 1100 * pitch;
  formant.Q.value = 2.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
  g.gain.setValueAtTime(gain, t + dur - 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(formant).connect(g).connect(master);
  o.start(t);
  lfo.start(t);
  o.stop(t + dur + 0.05);
  lfo.stop(t + dur + 0.05);
}

function burst(t, freq, q, dur, gain) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3, dur + 0.02);
}

function tone(t, freq, dur, gain, type, endFreq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}
