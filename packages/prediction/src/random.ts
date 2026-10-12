import type { Posterior } from './types.js';

export type Uint32Source = () => number;
export interface PosteriorSample { a: number; b: number }

export function seedFor(seed: number, m: number): number {
  let h = (seed ^ Math.imul(m + 1, 0x9e3779b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function splitmix32(seed: number): Uint32Source {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export function uniform(next: Uint32Source): number {
  return (next() + 0.5) / 4294967296;
}

// 正規乱数1個につき一様乱数を2個消費する。Box–Mullerのもう一方を保存して使い回すと既定の抽選順が変わる。
function normal(next: Uint32Source): number {
  return Math.sqrt(-2 * Math.log(uniform(next))) * Math.cos(2 * Math.PI * uniform(next));
}

export function gamma(alpha: number, next: Uint32Source): number {
  if (!Number.isFinite(alpha) || alpha < 1) {
    throw new RangeError('Gamma shape must be finite and >= 1');
  }

  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(next);
    const base = 1 + c * x;
    if (base <= 0) {
      continue;
    }
    const v = base * base * base;
    const u = uniform(next);
    if (
      u < 1 - 0.0331 * x ** 4 ||
      Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))
    ) {
      return d * v;
    }
  }
}

export function beta(alpha: number, betaShape: number, next: Uint32Source): number {
  const x = gamma(alpha, next);
  const y = gamma(betaShape, next);
  return x / (x + y);
}

export function samplePosterior(posterior: Posterior, count: number, seed: number): PosteriorSample[] {
  return Array.from({ length: count }, (_, m) => {
    const next = splitmix32(seedFor(seed, m));
    const a = beta(posterior.a.alpha, posterior.a.beta, next);
    const b = beta(posterior.b.alpha, posterior.b.beta, next);
    return { a, b };
  });
}
