import { describe, expect, it } from 'vitest';
import type { NodeView } from '../sim';
import { STATUS_WORD, buildingHealth } from './metrics';

const view = (v: Partial<NodeView>): NodeView => ({
  arrivals: 100, served: 100, queue: 0, dropped: 0, latencyMs: 5, errorRate: 0, saturation: 0.4, retryArrivals: 0, ...v,
});

describe('building status', () => {
  it('reads ok, strained or failing from the error rate and saturation', () => {
    expect(STATUS_WORD[buildingHealth(view({}))]).toBe('ok');
    expect(STATUS_WORD[buildingHealth(view({ saturation: 0.9 }))]).toBe('strained');
    expect(STATUS_WORD[buildingHealth(view({ errorRate: 0.02 }))]).toBe('strained');
    // full but keeping up (nothing waiting, nothing turned away) is strained, not failing
    expect(STATUS_WORD[buildingHealth(view({ saturation: 0.99 }))]).toBe('strained');
    expect(STATUS_WORD[buildingHealth(view({ saturation: 1, queue: 40 }))]).toBe('failing');
    expect(STATUS_WORD[buildingHealth(view({ saturation: 1, dropped: 5 }))]).toBe('failing');
    expect(STATUS_WORD[buildingHealth(view({ errorRate: 0.3 }))]).toBe('failing');
    expect(STATUS_WORD[buildingHealth(undefined)]).toBe('ok');
  });
});
