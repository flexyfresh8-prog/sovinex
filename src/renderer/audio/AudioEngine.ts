/**
 * Audio engine: decode, transport (play/pause/stop/seek/volume/loop),
 * low-rate analysis resample, test signal synthesis.
 * The animation clock is derived from the AudioContext clock — zero drift.
 */
import { TrackAnalysis } from '../../shared/types';
import { DriverModel, BoxModel } from '../../shared/physics/model';
import { analyzeTrack, ANALYSIS_SR } from '../../shared/audio/analysis';
export type TransportState = 'stopped' | 'playing' | 'paused';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private startCtxTime = 0;
  private startOffset = 0;
  private _state: TransportState = 'stopped';
  loop = false;
  onEnded: (() => void) | null = null;

  get state(): TransportState { return this._state; }
  get duration(): number { return this.buffer?.duration ?? 0; }
  get isLoaded(): boolean { return this.buffer !== null; }
  get currentSampleRate(): number { return this.buffer?.sampleRate ?? 48000; }

  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.75;
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Decode file bytes → AudioBuffer. */
  async decode(fileName: string, data: Uint8Array): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    const buf = new Uint8Array(data);
    const ab = buf.buffer as ArrayBuffer;
    const decoded = await ctx.decodeAudioData(ab.slice(0) as ArrayBuffer);
    this.buffer = decoded;
    this.startOffset = 0;
    this._state = 'stopped';
    return decoded;
  }

  /** Mono mixdown Float32Array (for waveform display + analysis). */
  monoMixdown(): Float32Array {
    if (!this.buffer) return new Float32Array(0);
    const ch = this.buffer.numberOfChannels;
    const len = this.buffer.length;
    const out = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const data = this.buffer.getChannelData(c);
      for (let i = 0; i < len; i++) out[i] += data[i] / ch;
    }
    return out;
  }

  /**
   * Resample mono to ANALYSIS_SR for offline physics analysis.
   * Uses OfflineAudioContext (band-limited, high quality).
   */
  async resampleForAnalysis(mono: Float32Array, srcRate: number): Promise<Float32Array> {
    const ratio = ANALYSIS_SR / srcRate;
    const outLen = Math.max(1, Math.floor(mono.length * ratio));
    const off = new OfflineAudioContext(1, outLen, ANALYSIS_SR);
    const buf = off.createBuffer(1, mono.length, srcRate);
    buf.copyToChannel(mono as Float32Array<ArrayBuffer>, 0);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0).slice();
  }

  /** Run the full analysis pipeline (chunked by caller if needed). */
  runAnalysis(mono8k: Float32Array, driver: DriverModel, box: BoxModel, volts: number): TrackAnalysis {
    return analyzeTrack({ mono: mono8k, sampleRate: ANALYSIS_SR, driver, box, voltsRMS: volts });
  }

  play(): void {
    if (!this.buffer || !this.ctx || !this.gain) return;
    this.stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this.loop;
    src.connect(this.gain);
    src.onended = () => {
      if (this._state === 'playing' && !this.loop) {
        this._state = 'stopped';
        this.startOffset = 0;
        this.onEnded?.();
      }
    };
    src.start(0, this.startOffset % this.buffer.duration);
    this.source = src;
    this.startCtxTime = this.ctx.currentTime;
    this._state = 'playing';
  }

  pause(): void {
    if (this._state !== 'playing') return;
    this.startOffset = this.position();
    this.stopSource();
    this._state = 'paused';
  }

  stop(): void {
    this.stopSource();
    this.startOffset = 0;
    this._state = 'stopped';
  }

  seek(sec: number): void {
    if (!this.buffer) return;
    const t = Math.max(0, Math.min(sec, this.buffer.duration - 0.01));
    this.startOffset = t;
    if (this._state === 'playing') this.play();
  }

  /** Current playhead in seconds (audio-clock derived). */
  position(): number {
    if (!this.buffer) return 0;
    if (this._state === 'playing' && this.ctx) {
      const raw = this.startOffset + (this.ctx.currentTime - this.startCtxTime);
      if (this.loop && this.buffer.duration > 0) return raw % this.buffer.duration;
      return Math.min(raw, this.buffer.duration);
    }
    return this.startOffset;
  }

  /** Exact fractional position including loop wrap for frame sampling. */
  framePosition(): number {
    return this.position();
  }

  setVolume(v: number): void {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, v));
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  /** Live context sample rate (for spectrum display). */
  liveSampleRate(): number { return this.ctx?.sampleRate ?? 48000; }

  private stopSource(): void {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  /** Synthesize demo/test signals offline (no external assets needed). */
  static async synthesizeTestSignal(kind: 'sweep' | 'kick' | 'tone40' | 'musicish', sampleRate = 48000): Promise<AudioBuffer> {
    const durations: Record<string, number> = { sweep: 16, kick: 14, tone40: 10, musicish: 18 };
    const dur = durations[kind];
    const off = new OfflineAudioContext(1, Math.ceil(dur * sampleRate), sampleRate);
    const total = Math.ceil(dur * sampleRate);
    const data = new Float32Array(total);

    if (kind === 'sweep') {
      let phase = 0;
      for (let i = 0; i < total; i++) {
        const t = i / sampleRate;
        const f = 20 * Math.pow(80 / 20, (t % 8) / 8); // 20→80Hz over 8s, repeats
        phase += (2 * Math.PI * f) / sampleRate;
        const env = Math.min(1, (t % 8) * 0.8) * Math.min(1, (8 - (t % 8)) * 1.2);
        data[i] = Math.sin(phase) * 0.6 * env;
      }
    } else if (kind === 'kick') {
      // 50 BPM deep kick
      const beat = 60 / 50;
      for (let i = 0; i < total; i++) {
        const t = i / sampleRate;
        const tb = t % beat;
        const f = 55 * Math.exp(-tb * 9) + 38;
        const env = Math.exp(-tb * 5.5);
        const phase = 2 * Math.PI * f * tb;
        data[i] = Math.sin(phase) * env * 0.85;
      }
    } else if (kind === 'tone40') {
      for (let i = 0; i < total; i++) {
        const t = i / sampleRate;
        const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t);
        data[i] = Math.sin(2 * Math.PI * 40 * t) * 0.7 * env;
      }
    } else {
      // pseudo-music: kick + bass line + hats-ish noise
      const beat = 0.5;
      let bassPhase = 0;
      for (let i = 0; i < total; i++) {
        const t = i / sampleRate;
        const tb = t % beat;
        const bar = Math.floor(t / (beat * 4)) % 4;
        const notes = [41.2, 46.25, 49, 38.9]; // E1, F#1, G1, D#1
        const f = notes[bar];
        bassPhase += (2 * Math.PI * f) / sampleRate;
        const kickEnv = Math.exp(-tb * 7) * (tb < 0.02 ? 1 : Math.exp(-tb * 2));
        const bass = Math.sin(bassPhase) * 0.35 * (0.55 + 0.45 * Math.sin(2 * Math.PI * f * tb * 0.5));
        const kick = Math.sin(2 * Math.PI * (52 * Math.exp(-tb * 10) + 42) * tb) * kickEnv * 0.6;
        const hat = ((i % 37) / 37 < 0.5 ? 1 : -1) * (Math.random() - 0.5) * 0.05 * Math.exp(-tb * 40);
        data[i] = Math.max(-1, Math.min(1, bass + kick + hat));
      }
    }
    const buf = off.createBuffer(1, total, sampleRate);
    buf.copyToChannel(data, 0);
    return buf;
  }

  /** Load a synthesized buffer directly (bypasses decode). */
  loadBuffer(buf: AudioBuffer): void {
    this.stopSource();
    this.buffer = buf;
    this.startOffset = 0;
    this._state = 'stopped';
  }

  dispose(): void {
    this.stopSource();
    this.buffer = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
