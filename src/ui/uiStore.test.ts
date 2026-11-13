import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from './uiStore';

const ui = () => useUi.getState();

beforeEach(() => {
  vi.useFakeTimers();
  ui().reset();
});
afterEach(() => vi.useRealTimers());

describe('ui store', () => {
  it('reset() cancels pending refusal timers, so an old timer cannot clear a newer refusal', () => {
    ui().refuse('rollback', 'That is already in progress');
    expect(vi.getTimerCount()).toBe(1);
    ui().reset();
    expect(ui().refusals).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reset() closes the chat and forgets unread lines and previews', () => {
    ui().openChat(true);
    ui().chatTo('boss');
    ui().noteLine('netops', 'CPU is pinned.', true);
    expect(ui().unread).toEqual({ netops: 1 });
    expect(ui().preview).toMatchObject({ castId: 'netops', text: 'CPU is pinned.' });
    ui().reset();
    expect(ui()).toMatchObject({ chatOpen: false, chatWith: null, unread: {}, preview: null });
  });

  it('a line from the character on screen is neither unread nor previewed', () => {
    ui().openChat(true);
    ui().chatTo('netops');
    ui().noteLine('netops', 'CPU is pinned.', true);
    expect(ui().unread).toEqual({});
    expect(ui().preview).toBeNull();
    // opening a character's thread reads it
    ui().noteLine('boss', 'Any news?', true);
    expect(ui().unread).toEqual({ boss: 1 });
    ui().chatTo('boss');
    expect(ui().unread).toEqual({});
    expect(ui().preview).toBeNull();
  });

  it('a streamed answer counts as unread but is not previewed', () => {
    ui().noteLine('netops', '', false);
    expect(ui().unread).toEqual({ netops: 1 });
    expect(ui().preview).toBeNull();
  });
});
