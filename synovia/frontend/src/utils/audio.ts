/**
 * Synovia Audio Engine — Geiger Counter proximity feedback
 * Uses Web Audio API only — no external assets needed.
 */

let ctx: AudioContext | null = null;
let geigerInterval: ReturnType<typeof setInterval> | null = null;
let currentClearance = 1.0;
let flatlineOsc: OscillatorNode | null = null;
let isFlatlined = false;

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

/** Single Geiger click — short white-noise burst */
function click(volume: number, pitch: number) {
  const c = getCtx();
  const buf = c.createBuffer(1, c.sampleRate * 0.012, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.3));
  }
  const src = c.createBufferSource();
  src.buffer = buf;

  const bpf = c.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 800 + pitch * 3000;
  bpf.Q.value = 1.2;

  const gain = c.createGain();
  gain.gain.value = volume * 0.4;

  src.connect(bpf);
  bpf.connect(gain);
  gain.connect(c.destination);
  src.start();
}

/** Harsh flatline beep — breach */
function startFlatline() {
  if (isFlatlined) return;
  isFlatlined = true;
  const c = getCtx();
  flatlineOsc = c.createOscillator();
  const g = c.createGain();
  flatlineOsc.type = 'sawtooth';
  flatlineOsc.frequency.value = 440;
  g.gain.value = 0.15;
  flatlineOsc.connect(g);
  g.connect(c.destination);
  flatlineOsc.start();
}

function stopFlatline() {
  if (flatlineOsc) { try { flatlineOsc.stop(); } catch {} flatlineOsc = null; }
  isFlatlined = false;
}

/**
 * Update proximity audio based on clearance to nearest no-fly zone.
 * clearance < 0  = breach (flatline)
 * clearance 0–0.35 = geiger clicks, rate and pitch scale with danger
 */
export function updateProximityAudio(clearance: number) {
  currentClearance = clearance;

  if (clearance < 0) {
    // Breach — flatline
    if (geigerInterval) { clearInterval(geigerInterval); geigerInterval = null; }
    startFlatline();
    return;
  }

  stopFlatline();

  if (clearance > 0.35) {
    // Safe zone — silence
    if (geigerInterval) { clearInterval(geigerInterval); geigerInterval = null; }
    return;
  }

  // Danger zone — Geiger clicks
  const danger = 1.0 - clearance / 0.35; // 0→1 as you approach
  const intervalMs = Math.max(60, 500 * (1 - danger * 0.88));
  const pitch = danger;
  const volume = 0.3 + danger * 0.7;

  // Restart interval at new rate
  if (geigerInterval) clearInterval(geigerInterval);
  geigerInterval = setInterval(() => click(volume, pitch), intervalMs);
}

export function stopAllAudio() {
  if (geigerInterval) { clearInterval(geigerInterval); geigerInterval = null; }
  stopFlatline();
}

export function resumeAudioContext() {
  if (ctx?.state === 'suspended') ctx.resume();
}
