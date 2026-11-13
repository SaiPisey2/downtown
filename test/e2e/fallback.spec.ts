import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** A browser that offers no WebGL2 context. */
async function withoutWebGL2(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
}

async function start(page: Page, caseId: string, query = ''): Promise<void> {
  await page.goto(`/?test=1${query}`);
  await page.evaluate((id) => window.__downtown!.state().start(id), caseId);
}

const tick = (page: Page) => page.evaluate(() => window.__downtown!.state().snap!.tick);
const status = (page: Page) => page.evaluate(() => window.__downtown!.state().snap!.status);

/** Moves focus to an element and presses Enter, as a keyboard player would after tabbing there. */
async function press(page: Page, name: string | RegExp, role: 'button' | 'tab' = 'button'): Promise<void> {
  await page.getByRole(role, { name }).focus();
  await page.keyboard.press('Enter');
}

/** Jumps the simulation to `tick` in one step and leaves it paused there (edge-rule runs 4 ticks a second). */
async function jumpTo(page: Page, target: number): Promise<void> {
  const reached = await page.evaluate((t) => {
    const h = window.__downtown!;
    h.state().setPaused(false);
    h.setSpeed((t - h.state().snap!.tick) / (0.25 * 4));
    h.advance(250);
    h.setSpeed(1);
    h.state().setPaused(true, 'user');
    return h.state().snap!.tick;
  }, target);
  expect(reached).toBe(target);
}

test('without WebGL2 the tutorial is won on the flat board from the keyboard', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await withoutWebGL2(page);

  // the title's city is the flat board too, and it cannot be picked or read out
  await page.goto('/?test=1');
  await expect(page.getByTestId('flat-board')).toBeVisible();
  await expect(page.getByTestId('flat-board')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('canvas')).toHaveCount(0);

  await start(page, 'tutorial');
  const board = page.getByRole('region', { name: 'City map of services. Use the building buttons to inspect.' });
  await expect(board).toBeVisible();
  await expect(board).toContainText('3D is not available in this browser, so this is the flat view.');
  await expect(page.getByTestId('board')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  for (const name of ['Gate', 'Shop', 'Ledger']) await expect(board.getByRole('button', { name: new RegExp(`^${name}:`) })).toBeVisible();

  // the shop's new build goes out at tick 12; its tile says it changed and is in trouble
  await expect.poll(() => tick(page), { timeout: 15_000 }).toBeGreaterThan(20);
  const shop = board.getByRole('button', { name: /^Shop:/ });
  await expect(shop).toContainText('changed');
  await expect(shop).toContainText(/strained|failing/);
  await expect(shop).toContainText(/load \d+/);
  await expect(shop).toContainText(/queued/);
  await expect(shop).toContainText(/errors/);
  await expect(shop).toHaveAccessibleName(/^Shop: (strained|failing), load \d+(\.\d)?%, [\d.k]+ queued, [\d.]+% errors, changed lately$/);

  await shop.focus();
  await page.keyboard.press('Enter');
  await expect(shop).toHaveAttribute('aria-pressed', 'true');
  await expect(shop).toHaveClass(/flat-tile-on/);
  const panel = page.getByRole('complementary', { name: /shop/i });
  await expect(panel).toBeVisible();

  // closing the panel from inside it gives focus back to the tile that opened it
  await press(page, 'Changes', 'tab');
  await expect(panel.getByRole('tabpanel')).toContainText('shop build 2');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(shop).toBeFocused();

  await page.keyboard.press('Enter');
  await press(page, 'Actions', 'tab');
  const rollback = panel.getByRole('button', { name: /roll back/i });
  await rollback.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Roll back the shop');
  await press(page, 'Confirm');
  await expect(rollback).toBeFocused();

  await expect.poll(() => status(page), { timeout: 30_000 }).toBe('won');
  await expect(page.getByText('Recovered')).toBeVisible();
  expect(errors).toEqual([]);
});

test('?flat=1 asks for the flat board even where 3D works', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'edge-rule', '&flat=1');
  const board = page.getByRole('region', { name: /city map of services/i });
  await expect(board).toContainText('This is the flat view of the city, as the address asks.');
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(board.getByRole('button')).toHaveCount(9);
  // roads are drawn under the tiles, one per edge, wider where the traffic is heavier
  await expect(board.locator('.flat-road')).toHaveCount(10);
  await jumpTo(page, 100);
  const width = (id: string) => board.locator(`.flat-road[data-edge="${id}"] line`).evaluate((l) => Number(l.getAttribute('stroke-width')));
  expect(await width('gate>edge')).toBeGreaterThan((await width('cache>db')) + 2);

  // the edge rule at its worst: failures on the road into the edge, and the edge failing
  await jumpTo(page, 320);
  await expect(board.locator('.flat-road-fail').first()).toBeVisible();
  await expect(board.getByRole('button', { name: /^Edge: failing/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a window narrower than 900 px shows only the desktop notice, and the game comes back when it widens', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/?test=1');
  await expect(page.getByRole('heading', { level: 1, name: 'Downtown' })).toBeVisible();
  await expect(page.getByText('Downtown needs a desktop browser for now.')).toBeVisible();
  await expect(page.getByRole('link', { name: /code/i })).toHaveAttribute('href', 'https://github.com/SaiPisey2/downtown');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(0);

  // a run on screen does not move while the window is too narrow
  await page.evaluate(() => window.__downtown!.state().start('tutorial'));
  const before = await tick(page);
  await page.waitForTimeout(1_000);
  expect(await tick(page)).toBe(before);
  await expect(page.locator('canvas')).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('desktop-only')).toHaveCount(0);
  await expect(page.getByRole('banner')).toBeVisible();
  await expect.poll(() => tick(page)).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('Reduce motion in Settings follows the system at first, stops the smoke, and is remembered for the tab', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, 'edge-rule');
  await page.getByRole('banner').getByRole('button', { name: /^settings/i }).click();
  const settings = page.getByRole('complementary', { name: 'Settings' });
  await expect(settings.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
  await expect(settings.getByRole('heading', { level: 3, name: /live characters/i })).toBeVisible();
  const motion = settings.getByRole('switch', { name: 'Reduce motion' });
  // follows the system's preference until the player chooses
  await expect(motion).toBeChecked();
  await motion.click();
  await expect(motion).not.toBeChecked();
  await expect(page.locator('html')).not.toHaveAttribute('data-motion', 'reduced');
  await motion.click();
  await expect(motion).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');

  await expect.poll(() => page.evaluate(() => window.__downtown!.fps()).catch(() => -1)).toBeGreaterThanOrEqual(0);
  await jumpTo(page, 320);
  await page.evaluate(() => window.__downtown!.state().setPaused(false));
  await expect.poll(() => page.evaluate(() => window.__downtown!.sceneStats().failedDots), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1_000);
  const stats = await page.evaluate(() => window.__downtown!.sceneStats());
  expect(stats.smoke).toBe(0);
  expect(stats.nodes.edge!.glow).toBeGreaterThan(0);

  // the choice outlives a reload in this tab, over the system's preference
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  expect(await page.evaluate(() => window.__downtown!.state().reducedMotion)).toBe(true);
  expect(errors).toEqual([]);
});

test('landmarks: one main per screen, a named city, a timer for the clock', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('button', { name: 'Tutorial' }).click();
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Game controls' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('region', { name: 'City map of services. Use the building buttons to inspect.' })).toBeVisible();
  await expect(page.getByRole('timer', { name: 'Simulated time' })).toContainText(/Elapsed/);
  await page.getByRole('banner').getByRole('button', { name: /^team/i }).click();
  await expect(page.getByRole('complementary', { name: /team chat/i }).getByRole('log')).toHaveAttribute('aria-live', 'polite');
  await page.getByRole('banner').getByRole('button', { name: /hint/i }).click();
  await expect(page.locator('.toast').first()).toHaveAttribute('role', 'status');
  await page.evaluate(() => window.__downtown!.state().finish());
  await expect(page.getByRole('main')).toHaveCount(1);
});

test('Tab from the top of the play screen goes through the HUD, then the dock, then the buildings', async ({ page }) => {
  await start(page, 'tutorial');
  await page.evaluate(() => window.__downtown!.state().setPaused(true, 'user'));
  await page.getByRole('banner').getByRole('button', { name: /change log/i }).click();
  await expect(page.getByRole('complementary', { name: /change log/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ledger', exact: true })).toBeVisible();
  // the top of the page: a click on the case's title (nothing there takes focus) starts Tab from there
  await page.getByRole('banner').getByRole('heading', { level: 1 }).click();

  const order: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '';
        const where = el.closest('header.hud') ? 'hud' : el.closest('.dock-slot') ? 'dock' : el.closest('.chat-slot') ? 'chat' : el.dataset.node ? 'building' : 'other';
        return `${where}:${el.dataset.node ?? el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''}`;
      }),
    );
  }
  // one trip round the page: up to where focus comes back to where it started
  const cycle = order.slice(0, order.indexOf(order[0]!, 1));
  expect(cycle.length, order.join(' | ')).toBeGreaterThan(8);
  const first = (kind: string) => cycle.findIndex((x) => x.startsWith(`${kind}:`));
  const last = (kind: string) => cycle.map((x) => x.split(':')[0]).lastIndexOf(kind);
  expect(cycle[0], cycle.join(' | ')).toBe('hud:Team');
  expect(first('dock')).toBeGreaterThan(last('hud'));
  expect(first('building')).toBeGreaterThan(last('dock'));
  expect(cycle).toContain('hud:Settings');
  expect(cycle).toContain('dock:Close change log');
  expect(cycle.filter((x) => x.startsWith('building:'))).toEqual(['building:gate', 'building:shop', 'building:ledger']);
});

test('Tab and Shift+Tab stay inside the confirm dialog', async ({ page }) => {
  await start(page, 'tutorial');
  await page.evaluate(() => window.__downtown!.state().setPaused(true, 'user'));
  await press(page, 'Shop');
  await press(page, 'Actions', 'tab');
  await press(page, /roll back/i);
  const dialog = page.getByRole('dialog');
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: /roll back/i })).toBeFocused();
});

test('the city behind the title is alive: traffic flows, and hiding the tab does not freeze it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no orbit, so only the traffic moves
  await page.goto('/?test=1');
  await expect.poll(() => page.evaluate(() => window.__downtown!.sceneStats().dots).catch(() => 0)).toBeGreaterThan(50);
  const board = page.getByTestId('board');
  const frames = async () => {
    const a = await board.screenshot();
    await page.waitForTimeout(600);
    return !a.equals(await board.screenshot());
  };
  expect(await frames()).toBe(true);

  // the tab goes into the background and comes back
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => window.__downtown!.state().paused)).toBe(false);
  expect(await frames()).toBe(true);
});
