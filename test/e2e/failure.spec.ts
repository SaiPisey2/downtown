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
  // the board registers its probe once it has mounted
  await expect.poll(() => page.evaluate(() => window.__downtown!.fps()).catch(() => -1)).toBeGreaterThanOrEqual(0);
}

/**
 * Jumps the simulation straight to `tick` in one synchronous step, then lets it
 * run on at normal speed so the dots keep moving.
 */
async function jumpTo(page: Page, tick: number): Promise<void> {
  const reached = await page.evaluate((target) => {
    const h = window.__downtown!;
    const now = h.state().snap!.tick;
    // advance() takes at most 250 ms at a time; edge-rule runs 4 ticks per second
    h.setSpeed((target - now) / (0.25 * 4));
    h.advance(250);
    h.setSpeed(1);
    // read in the same task: the next frame may already step on
    return h.state().snap!.tick;
  }, tick);
  expect(reached).toBe(tick);
}

const stats = (page: Page) => page.evaluate(() => window.__downtown!.sceneStats());

test('the edge-rule city shows where it broke and that it spread', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await start(page, 'edge-rule');

  await jumpTo(page, 200);
  await expect.poll(async () => (await stats(page)).dots, { timeout: 15_000 }).toBeGreaterThan(0);
  const calm = await stats(page);
  expect(calm.failedDots).toBe(0);
  expect(calm.retryDots).toBe(0);
  const [r0, g0, b0] = calm.nodes.edge!.tint;
  expect(g0).toBeGreaterThan(r0);
  expect(b0).toBeGreaterThan(r0);
  expect(calm.nodes.edge!.glow).toBe(0);
  expect(calm.nodes.edge!.queue).toBe(0);
  expect(calm.nodes.filter!.crane).toBe(false);
  expect(calm.smoke).toBe(0);

  await jumpTo(page, 320);
  await expect.poll(async () => (await stats(page)).failedDots, { timeout: 15_000 }).toBeGreaterThan(0);
  // the share of dots in trouble, not their number: thinning may halve the total.
  // The old calm dots on the roads out of the edge drain as they arrive, so wait for the mix to turn over.
  await expect
    .poll(async () => {
      const s = await stats(page);
      return (s.failedDots + s.retryDots) / s.dots;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0.35);
  const bad = await stats(page);
  expect(bad.retryDots).toBeGreaterThan(0);
  const edge = bad.nodes.edge!;
  expect(edge.glow).toBeGreaterThan(0);
  expect(edge.queue).toBe(12);
  const [r1, g1, b1] = edge.tint;
  expect(r1).toBeGreaterThan(g1);
  expect(r1).toBeGreaterThan(b1);
  // the red spreads upstream to the gate; downstream stays calm
  expect(bad.nodes.gate!.tint[0]).toBeGreaterThan(bad.nodes.gate!.tint[1]);
  expect(bad.nodes.web!.tint[1]).toBeGreaterThan(bad.nodes.web!.tint[0]);
  expect(bad.nodes.filter!.crane).toBe(true);
  expect(bad.nodes.edge!.crane).toBe(false);
  await expect.poll(async () => (await stats(page)).smoke, { timeout: 15_000 }).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('reduced motion stops the smoke', async ({ page }) => {
  test.setTimeout(60_000);
  await start(page, 'edge-rule');
  await page.evaluate(() => window.__downtown!.state().setReducedMotion(true));
  await jumpTo(page, 320);
  await expect.poll(async () => (await stats(page)).failedDots, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect((await stats(page)).smoke).toBe(0);
  expect((await stats(page)).nodes.edge!.glow).toBeGreaterThan(0);
});

test('a drag that starts and ends on a building does not select it', async ({ page }) => {
  await start(page, 'tutorial');
  const at = await page.evaluate(() => window.__downtown!.nodeScreen('shop'));

  await page.mouse.move(at[0], at[1]);
  await page.mouse.down();
  for (let i = 1; i <= 7; i++) await page.mouse.move(at[0] + i * 2, at[1]);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__downtown!.state().selected)).toBeNull();

  // a plain click on the same spot does select it
  const again = await page.evaluate(() => window.__downtown!.nodeScreen('shop'));
  await page.mouse.click(again[0], again[1]);
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().selected)).toBe('shop');
});

test('clicking the selected building again brings the camera back to it', async ({ page }) => {
  await start(page, 'tutorial');
  const target = () => page.evaluate(() => window.__downtown!.camera().target);
  const gate = page.getByRole('button', { name: 'Gate', exact: true });
  await gate.click();
  // the tutorial gate stands at grid (0, 0): world (0, 0, 0)
  await expect.poll(async () => Math.hypot(...(await target()).map((v, i) => v - [0, 0, 0][i]!))).toBeLessThan(0.05);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => Math.hypot(...(await target()).map((v, i) => v - [0, 0, 0][i]!))).toBeGreaterThan(1);
  await gate.click();
  await expect.poll(async () => Math.hypot(...(await target()).map((v, i) => v - [0, 0, 0][i]!))).toBeLessThan(0.05);
});
