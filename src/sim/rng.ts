import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64';
import { uniformInt } from 'pure-rand/distribution/uniformInt';

export function makeRng(seed: number): { next(): number; int(maxExclusive: number): number } {
  const gen = xoroshiro128plus(seed); // mutable generator
  return {
    next: () => uniformFloat64(gen),
    int: (maxExclusive) => (maxExclusive <= 1 ? 0 : uniformInt(gen, 0, maxExclusive - 1)),
  };
}
