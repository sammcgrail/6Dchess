/* Small synthesized sound effects (Web Audio, no asset files) */

type SoundName = 'move' | 'capture' | 'check' | 'portal' | 'end';

const STORAGE_KEY = '6dchess-muted';

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _muted = false;

  constructor() {
    try {
      this._muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // storage unavailable (private mode etc.) - default to sound on
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // ignore
    }
  }

  /** Lazily create the audio graph; browsers only allow this after a user gesture */
  private _context(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private _tone(freq: number, start: number, duration: number, type: OscillatorType, gain: number, endFreq?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env).connect(this.master!);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private _noise(start: number, duration: number, gain: number, fromHz: number, toHz: number): void {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(fromHz, start);
    filter.frequency.exponentialRampToValueAtTime(toHz, start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + duration * 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(filter).connect(env).connect(this.master!);
    src.start(start);
  }

  play(name: SoundName): void {
    if (this._muted) return;
    const ctx = this._context();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (name) {
      case 'move':
        this._tone(520, t, 0.07, 'triangle', 0.5, 300);
        break;
      case 'capture':
        this._tone(260, t, 0.12, 'square', 0.25, 120);
        this._tone(700, t, 0.05, 'triangle', 0.35);
        break;
      case 'check':
        this._tone(880, t, 0.12, 'sine', 0.35);
        this._tone(1320, t + 0.09, 0.16, 'sine', 0.3);
        break;
      case 'portal':
        this._noise(t, 0.45, 0.6, 300, 3000);
        this._tone(220, t, 0.4, 'sine', 0.2, 880);
        break;
      case 'end':
        [523, 659, 784, 1047].forEach((f, i) => this._tone(f, t + i * 0.09, 0.6, 'sine', 0.22));
        break;
    }
  }
}

export const sound = new SoundManager();
