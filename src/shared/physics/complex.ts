/** Minimal complex number helpers for the lumped-parameter solver. */
export interface Cx { re: number; im: number }

export const cx = (re: number, im = 0): Cx => ({ re, im });
export const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const csub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im);
export const cargs = (a: Cx): number => Math.atan2(a.im, a.re);
export const cscale = (a: Cx, s: number): Cx => ({ re: a.re * s, im: a.im * s });

/** Solve 2x2 complex linear system [a b; c d] * [x1 x2] = [e f] */
export function solve2x2(a: Cx, b: Cx, c: Cx, d: Cx, e: Cx, f: Cx): [Cx, Cx] {
  const det = csub(cmul(a, d), cmul(b, c));
  const x1 = cdiv(csub(cmul(e, d), cmul(b, f)), det);
  const x2 = cdiv(csub(cmul(a, f), cmul(e, c)), det);
  return [x1, x2];
}
