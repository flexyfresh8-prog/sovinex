/**
 * Radix-2 iterative FFT with Hann window. Pure TypeScript, no dependencies.
 * Input/output are Float64Arrays; complex interleaved (re, im).
 */
export class FFT {
  readonly size: number;
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0 || size < 4) throw new Error('FFT size must be a power of two >= 4');
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    let bits = 0;
    while (1 << bits < size) bits++;
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** In-place forward FFT on interleaved complex data. */
  forward(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const wr = this.cos[tw], wi = this.sin[tw];
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + half] * wr - im[i + k + half] * wi;
          const vi = re[i + k + half] * wi + im[i + k + half] * wr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
        }
      }
    }
  }

  /** In-place inverse FFT (normalized by 1/n). */
  inverse(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    // conjugate trick
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.forward(re, im);
    const inv = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= inv; im[i] *= -inv; }
  }
}

/** Hann window with periodic convention. */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

/** RMS of a buffer segment. */
export function rms(buf: Float32Array | Float64Array, start = 0, len = buf.length - start): number {
  let s = 0;
  const end = Math.min(start + len, buf.length);
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(end - start, 1));
}
