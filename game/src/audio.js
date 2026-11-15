// All sound is synthesised with WebAudio: no audio files, nothing fetched.
// Short filtered-noise bursts make gunfire, filtered tones make the charge's
// beeps and the round stingers. The context is created lazily on the first
// user gesture (browsers refuse it earlier); until then every call is a no-op,
// which also keeps screenshot mode silent and deterministic.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise(dur, filterFreq, gainPeak, type = 'bandpass', sweepTo = null) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.2, dur + 0.05);
  }

  function tone(freq, dur, gainPeak, type = 'square', when = 0, slideTo = null) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    // Gunfire: a crack (high noise) over a body thump (low noise). Volume and
    // brightness fall with the `dist` the listener hears it from.
    shot(kind, dist = 0) {
      const att = 1 / (1 + dist * 0.12);
      if (kind === 'sniper') {
        noise(0.32, 900, 0.75 * att, 'lowpass', 120);
        noise(0.1, 3200, 0.5 * att);
      } else if (kind === 'smg' || kind === 'pistol') {
        noise(0.09, 2400, 0.4 * att);
        noise(0.07, 500, 0.3 * att, 'lowpass');
      } else {
        noise(0.14, 1900, 0.55 * att);
        noise(0.1, 420, 0.4 * att, 'lowpass');
      }
    },
    dryFire() { tone(1400, 0.03, 0.12, 'square'); },
    reload() { noise(0.06, 1200, 0.2); tone(300, 0.05, 0.1, 'square', 0.12); noise(0.05, 900, 0.22, 'bandpass', null); },
    hit(head) { tone(head ? 1500 : 1050, 0.06, 0.2, 'sine'); },
    kill() { tone(760, 0.09, 0.22, 'sine'); tone(1140, 0.12, 0.2, 'sine', 0.07); },
    hurt() { noise(0.12, 300, 0.35, 'lowpass'); },
    throwIt() { noise(0.15, 700, 0.12, 'bandpass', 1800); },
    bounce() { tone(210, 0.05, 0.15, 'sine'); },
    explosion() {
      noise(0.9, 160, 1.0, 'lowpass', 40);
      tone(58, 0.8, 0.7, 'sine', 0, 30);
    },
    flashPop() { noise(0.2, 4000, 0.4, 'highpass'); tone(2400, 0.15, 0.1, 'sine', 0, 500); },
    plantBeep(final = false) { tone(final ? 1560 : 1180, final ? 0.16 : 0.07, 0.2, 'square'); },
    defuseDone() { tone(880, 0.1, 0.2, 'square'); tone(1320, 0.16, 0.2, 'square', 0.1); },
    buy() { tone(980, 0.05, 0.14, 'sine'); tone(1470, 0.07, 0.12, 'sine', 0.05); },
    denied() { tone(220, 0.09, 0.16, 'square'); },
    roundWin() { tone(523, 0.12, 0.2, 'triangle'); tone(659, 0.12, 0.2, 'triangle', 0.11); tone(784, 0.22, 0.22, 'triangle', 0.22); },
    roundLose() { tone(392, 0.14, 0.2, 'triangle'); tone(330, 0.14, 0.2, 'triangle', 0.13); tone(262, 0.26, 0.22, 'triangle', 0.26); },
    step(dist) { noise(0.05, 500, 0.05 / (1 + dist * 0.2), 'lowpass'); },
    // Radio squelch: a clipped static tick under each bot callout.
    radioBlip() { noise(0.045, 1500, 0.1, 'bandpass'); tone(1250, 0.03, 0.05, 'square', 0.01); },
  };
}
