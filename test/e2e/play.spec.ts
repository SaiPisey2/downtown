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

async function start(page: Page, caseId: string): Promise<void> {
  await page.goto('/?test=1');
  await page.evaluate((id) => window.__downtown!.state().start(id), caseId);
  await expect.poll(() => page.evaluate(() => window.__downtown!.fps()).catch(() => -1)).toBeGreaterThanOrEqual(0);
}

const tick = (page: Page) => page.evaluate(() => window.__downtown!.state().snap!.tick);
const status = (page: Page) => page.evaluate(() => window.__downtown!.state().snap!.status);

/** Moves focus to an element and presses Enter, as a keyboard player would after tabbing there. */
async function press(page: Page, name: string | RegExp, role: 'button' | 'tab' = 'button'): Promise<void> {
  await page.getByRole(role, { name }).focus();
  await page.keyboard.press('Enter');
}

test('the tutorial is played to a win from the keyboard', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await start(page, 'tutorial');
  // the shop's new build goes out at tick 12
  await expect.poll(() => tick(page), { timeout: 15_000 }).toBeGreaterThan(13);

  // the HUD: clock, impact, pause, hint, home view
  const hud = page.getByRole('banner');
  await expect(hud.getByText('customer impact')).toBeVisible();
  for (const name of [/pause/i, /hint/i, /home view/i, /change log/i]) await expect(hud.getByRole('button', { name })).toBeVisible();

  await page.getByRole('button', { name: 'Shop', exact: true }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: /shop/i });
  await expect(panel).toBeVisible();

  // a graph: an inline chart with its current value and unit beside it
  await expect(panel.getByRole('tab', { name: 'Graphs' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('img', { name: /saturation/i })).toBeVisible();
  await expect(panel.getByText(/\d+ ?%/).first()).toBeVisible();

  // the deploy in the shop's changes, which also counts as reading the changes
  await press(page, 'Changes', 'tab');
  await expect(panel.getByRole('tabpanel')).toContainText('shop build 2');
  await expect(page.getByRole('status').filter({ hasText: 'Clue found' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().found)).toContain('new_build');

  // the city-wide change log
  await press(page, /change log/i);
  const log = page.getByRole('complementary', { name: /change log/i });
  await expect(log).toContainText('shop build 2');
  await page.keyboard.press('Escape');
  await expect(log).toHaveCount(0);

  // act: roll back, confirm, see the countdown
  await page.getByRole('button', { name: 'Shop', exact: true }).focus();
  await page.keyboard.press('Enter');
  await press(page, 'Actions', 'tab');
  const rollback = panel.getByRole('button', { name: /roll back/i });
  await rollback.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Roll back the shop');
  await expect(dialog).toContainText(/takes \d+ s/i);
  await press(page, 'Confirm');
  await expect(dialog).toHaveCount(0);
  // focus is back on the button that opened the dialog
  await expect(rollback).toBeFocused();

  // pressing the same action again at once is refused in plain words, and there is still one countdown;
  // paused, so the first rollback cannot land in between however slow the machine is
  await page.evaluate(() => window.__downtown!.state().setPaused(true, 'user'));
  await page.keyboard.press('Enter');
  await press(page, 'Confirm');
  await expect(panel.getByText('That is already in progress')).toBeVisible();
  await expect(panel.getByText(/lands in/i)).toHaveCount(1);
  await expect(hud.getByText(/lands in/i)).toHaveCount(1);
  await page.evaluate(() => window.__downtown!.state().setPaused(false));

  await expect.poll(() => status(page), { timeout: 20_000 }).toBe('won');
  await expect(page.getByText('Recovered')).toBeVisible();
  // once the run is over, nothing that acts on it can be pressed
  await expect(hud.getByRole('button', { name: /hint/i })).toBeDisabled();
  await expect(hud.getByRole('button', { name: /pause|resume/i })).toBeDisabled();
  await expect(rollback).toBeDisabled();
  expect(errors).toEqual([]);
});

test('arrow keys inside the panel move between tabs and leave the camera alone', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'tutorial');
  await page.getByRole('button', { name: 'Gate', exact: true }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: /gate/i });
  await expect(panel).toBeVisible();

  const cam = () => page.evaluate(() => window.__downtown!.camera());
  // let the camera finish easing onto the gate, at world (0, 0, 0); a still camera alone is not enough,
  // since the ease may not have started on the first frames
  await expect.poll(async () => Math.hypot(...(await cam()).target), { timeout: 10_000 }).toBeLessThan(0.05);
  let before = await cam();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const now = await cam();
    const moved = Math.hypot(...now.position.map((v, j) => v - before.position[j]!));
    before = now;
    if (moved < 1e-4) break;
  }

  await panel.getByRole('tab', { name: 'Graphs' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('tab', { name: 'Logs' })).toBeFocused();
  await expect(panel.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(500);
  const after = await cam();
  expect(Math.hypot(...after.position.map((v, j) => v - before.position[j]!))).toBeLessThan(1e-6);

  // Escape closes the panel
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('pause, hints and the away notice', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'tutorial');
  await expect.poll(() => tick(page), { timeout: 15_000 }).toBeGreaterThan(13);

  await page.keyboard.press('p');
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().paused)).toBe(true);
  const t = await tick(page);
  await page.waitForTimeout(600);
  expect(await tick(page)).toBe(t);
  await expect(page.getByRole('button', { name: /resume/i }).first()).toBeVisible();
  await page.keyboard.press('p');
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().paused)).toBe(false);

  const hint = page.getByRole('button', { name: /hint/i });
  await expect(hint).toContainText('−3 points');
  await hint.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: /^Hint:/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'No more hints' })).toBeVisible();

  await page.evaluate(() => window.__downtown!.state().setPaused(true, 'hidden'));
  const away = page.getByRole('dialog', { name: 'Paused while you were away' });
  await expect(away).toBeVisible();
  await expect(away.getByRole('button', { name: 'Resume' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(away).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().paused)).toBe(false);
  expect(errors).toEqual([]);
});

test('watching the edge graph for a second finds the clue', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await start(page, 'edge-rule');
  await page.evaluate(() => {
    const h = window.__downtown!;
    h.setSpeed(320);
    h.advance(250);
    h.setSpeed(1);
  });
  await page.getByRole('button', { name: 'Edge', exact: true }).focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: /edge/i });
  await expect(panel.getByRole('img', { name: /saturation/i })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().found), { timeout: 5_000 }).toContain('cpu_everywhere');
  await expect(page.getByRole('status').filter({ hasText: 'Clue found' })).toBeVisible();

  await press(page, /notebook/i);
  await expect(page.getByRole('complementary', { name: /notebook/i })).toContainText('Every edge machine is out of CPU');
  expect(errors).toEqual([]);
});

/** Runs the simulation forward to `tick` in one step. */
async function jumpTo(page: Page, t: number): Promise<void> {
  await page.evaluate((to) => {
    const h = window.__downtown!;
    const now = h.state().snap!.tick;
    if (to <= now) return;
    h.setSpeed((to - now) / (0.25 * 4));
    h.advance(250);
    h.setSpeed(1);
  }, t);
}

const looks = (page: Page, route: string) =>
  page.evaluate((r) => window.__downtown!.state().run!.inputs.filter((i) => i.kind === 'observe' && i.route === r).length, route);

test('graphs left open from before the fault find the key clue when it shows, with one recorded look', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await start(page, 'edge-rule');
  await jumpTo(page, 200);
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  const panel = page.getByRole('complementary', { name: /edge building/i });
  await expect(panel.getByRole('img', { name: /saturation/i })).toBeVisible();
  // longer than a graph needs to count as looked at; nothing to find yet, so nothing is recorded
  await page.waitForTimeout(1500);
  expect(await looks(page, 'graph:edge.saturation')).toBe(0);
  expect(await page.evaluate(() => window.__downtown!.state().found)).toEqual([]);

  // the panel stays open while the fault arrives
  await jumpTo(page, 260);
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().found), { timeout: 5_000 }).toContain('cpu_everywhere');
  await expect(page.getByRole('status').filter({ hasText: 'Clue found' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await looks(page, 'graph:edge.saturation')).toBe(1);
  expect(errors).toEqual([]);
});

test('the change log left open across the deploy finds the deploy clue, with one recorded look', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await start(page, 'edge-rule');
  await jumpTo(page, 200);
  await press(page, /change log/i);
  const log = page.getByRole('complementary', { name: /change log/i });
  await expect(log).toContainText('Nothing has changed yet today.');
  expect(await looks(page, 'changes')).toBe(0);

  await jumpTo(page, 250);
  await expect(log).toContainText('rules update 412');
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().found), { timeout: 5_000 }).toContain('deploy_before');
  await page.waitForTimeout(1000);
  expect(await looks(page, 'changes')).toBe(1);
  expect(errors).toEqual([]);
});

test('coming back to the play screen starts with a clean interface', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'tutorial');
  await press(page, /notebook/i);
  await expect(page.getByRole('complementary', { name: /notebook/i })).toBeVisible();
  await press(page, /^team/i);
  await expect(page.getByRole('complementary', { name: /team chat/i })).toBeVisible();
  // leave the play screen and come back to a new run
  await page.evaluate(() => window.__downtown!.state().finish());
  await expect(page.getByRole('banner')).toHaveCount(0);
  await page.evaluate(() => window.__downtown!.state().start('tutorial'));
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  expect(errors).toEqual([]);
});
