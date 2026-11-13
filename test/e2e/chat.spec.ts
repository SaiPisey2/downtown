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

/** Steps the simulation straight to `tick` in one call and leaves it paused there (edge-rule runs 4 ticks per second). */
async function jumpTo(page: Page, tick: number): Promise<void> {
  const reached = await page.evaluate((target) => {
    const h = window.__downtown!;
    h.state().setPaused(false);
    h.setSpeed((target - h.state().snap!.tick) / (0.25 * 4));
    h.advance(250);
    h.setSpeed(1);
    h.state().setPaused(true, 'user');
    return h.state().snap!.tick;
  }, tick);
  expect(reached).toBe(tick);
}

const runLog = (page: Page) => page.evaluate(() => window.__downtown!.state().run!.log.map((e) => ({ ...e })));

/** Moves focus to a control and presses Enter, as a keyboard player would. */
async function press(page: Page, scope: ReturnType<Page['getByRole']> | Page, name: string | RegExp): Promise<void> {
  await scope.getByRole('button', { name }).focus();
  await page.keyboard.press('Enter');
}

const ATTACK = 'Are we being attacked?';
const VOLUME_Q = 'Is this an attack? How is the traffic?';
const VOLUME_A = 'Volume is normal. Same sources as yesterday.';
const HONEST = 'Many visitors are seeing errors. We are looking into it and will post again soon.';
const ACK = 'Thanks, that is clear. I will post it as it is.';
const NUDGE = 'I have not heard anything new in a while';

test('questions for a teammate, status updates for the stakeholder', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await start(page, 'edge-rule');
  const hud = page.getByRole('banner');
  const team = hud.getByRole('button', { name: /^team/i });
  await expect(team).toHaveAttribute('aria-pressed', 'false');

  // the stakeholder's question arrives at tick 300, previewed while the chat is closed
  await jumpTo(page, 299);
  await expect(page.getByRole('status').filter({ hasText: ATTACK })).toHaveCount(0);
  await jumpTo(page, 300);
  const preview = page.getByRole('status').filter({ hasText: ATTACK });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Ruth');
  await expect(team).toContainText('1');

  await press(page, hud, /^team/i);
  const chat = page.getByRole('complementary', { name: /team chat/i });
  await expect(chat).toBeVisible();
  await expect(team).toHaveAttribute('aria-pressed', 'true');

  // Ruth's thread holds the question; opening it reads it
  await press(page, chat, /ruth/i);
  await expect(chat.getByRole('button', { name: /ruth/i })).toHaveAttribute('aria-pressed', 'true');
  const ruthLog = chat.getByRole('log', { name: /ruth/i });
  await expect(ruthLog).toHaveAttribute('aria-live', 'polite');
  await expect(ruthLog).toContainText(ATTACK);
  await expect(team).not.toContainText('1');

  // ask the network teammate about volume: the question, then her answer, then the clue
  await press(page, chat, /nadia/i);
  await press(page, chat, VOLUME_Q);
  const nadiaLog = chat.getByRole('log', { name: /nadia/i });
  await expect(nadiaLog.getByRole('listitem').filter({ hasText: VOLUME_Q })).toHaveCount(1);
  await expect(nadiaLog).toContainText(VOLUME_A);
  await expect.poll(async () => (await runLog(page)).some((e) => e.type === 'clue' && e.clueId === 'volume_normal')).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Clue found' })).toBeVisible();
  // the newest line is at the bottom
  await expect(nadiaLog.getByRole('listitem').last()).toContainText(VOLUME_A);

  // camera keys stay inactive while focus is inside the chat dock
  const cam = () => page.evaluate(() => window.__downtown!.camera());
  const before = await cam();
  await chat.getByRole('button', { name: VOLUME_Q }).focus();
  for (const k of ['ArrowLeft', 'ArrowUp', 'Shift+ArrowRight', '+']) await page.keyboard.press(k);
  await page.waitForTimeout(400);
  const after = await cam();
  expect(Math.hypot(...after.position.map((v, j) => v - before.position[j]!))).toBeLessThan(1e-6);

  // an honest update: the player's line in Ruth's thread, then her reply on the next tick
  await press(page, chat, /ruth/i);
  await expect(chat.getByRole('button', { name: VOLUME_Q })).toHaveCount(0);
  await press(page, chat, HONEST);
  await expect(ruthLog.getByRole('listitem').last()).toContainText(HONEST);
  await expect.poll(async () => (await runLog(page)).filter((e) => e.type === 'update').map((e) => e.type === 'update' && e.id)).toEqual(['investigating']);
  await jumpTo(page, 301);
  await expect(ruthLog.getByRole('listitem').last()).toContainText(ACK);

  // that update covered the first window (242-361); the second (362-481) passes in silence: one nudge
  await jumpTo(page, 400);
  await expect(ruthLog.getByText(NUDGE)).toHaveCount(0);
  await jumpTo(page, 490);
  await expect(ruthLog.getByText(NUDGE)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('after the run ends the stakeholder states the outcome and nothing can be sent', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await start(page, 'edge-rule');
  await page.evaluate(() => {
    const h = window.__downtown!;
    h.setSpeed(20_000);
    h.advance(250);
    h.setSpeed(1);
  });
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().snap!.status)).toBe('lost');

  const hud = page.getByRole('banner');
  await press(page, hud, /^team/i);
  const chat = page.getByRole('complementary', { name: /team chat/i });
  await press(page, chat, /ruth/i);
  const ruthLog = chat.getByRole('log', { name: /ruth/i });
  await expect(ruthLog.getByRole('listitem').last()).toContainText('Customers are still seeing errors');
  await expect(chat.getByRole('button', { name: HONEST })).toBeDisabled();
  await chat.getByRole('button', { name: /nadia/i }).click();
  await expect(chat.getByRole('button', { name: VOLUME_Q })).toBeDisabled();

  // the HUD controls that act on the run are off too
  await expect(hud.getByRole('button', { name: /hint/i })).toBeDisabled();
  await expect(hud.getByRole('button', { name: /pause|resume/i })).toBeDisabled();
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('complementary', { name: /filter building/i }).getByRole('tab', { name: 'Actions' }).click();
  const actions = page.getByRole('complementary', { name: /filter building/i }).getByRole('tabpanel').getByRole('button');
  expect(await actions.count()).toBeGreaterThan(0);
  for (const b of await actions.all()) await expect(b).toBeDisabled();
  expect(errors).toEqual([]);
});
