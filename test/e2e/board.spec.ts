import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Vec3 = [number, number, number];

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
}

const target = (page: Page) => page.evaluate(() => window.__downtown!.camera().target);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cam = (page: Page) => page.evaluate(() => window.__downtown!.camera());
const reach = async (page: Page) => {
  const c = await cam(page);
  return dist(c.position, c.target);
};
/** Waits until the camera holds still for 300 ms, so pending key presses and damping have played out. */
async function settled(page: Page) {
  let last = await cam(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(300);
    const now = await cam(page);
    const moved = dist(now.position, last.position) + dist(now.target, last.target);
    last = now;
    if (moved < 1e-4) return now;
  }
  throw new Error('camera never settled');
}

test('the tutorial board draws, labels its buildings and selects them', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'tutorial');

  await expect(page.getByTestId('board').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('app')).toBeVisible();
  for (const name of ['Gate', 'Shop', 'Ledger']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => window.__downtown!.canvasColors())).toBeGreaterThan(1);

  const home = await target(page);

  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().selected)).toBe('shop');

  // the gate sits two grid steps from the centre, so the camera has to travel
  await page.getByRole('button', { name: 'Gate', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().selected)).toBe('gate');
  await expect.poll(async () => dist(await target(page), home)).toBeGreaterThan(3);

  await page.keyboard.press('h');
  await expect.poll(async () => dist(await target(page), home)).toBeLessThan(0.05);

  await page.getByRole('button', { name: 'Ledger', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().selected)).toBe('ledger');

  expect(errors).toEqual([]);
});

test('the camera can be driven from the keyboard alone', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'tutorial');
  // the board registers its probe once it has mounted; until then the hook throws
  await expect
    .poll(() => page.evaluate(() => window.__downtown!.canvasColors()).catch(() => 0))
    .toBeGreaterThan(1);
  const home = await settled(page);

  // ArrowRight orbits: the camera moves, the point it looks at does not
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => dist((await cam(page)).position, home.position)).toBeGreaterThan(0.1);
  expect(dist((await settled(page)).target, home.target)).toBeLessThan(1e-6);

  // + zooms in, and never past the closest distance
  const before = await reach(page);
  await page.keyboard.press('+');
  await expect.poll(() => reach(page)).toBeLessThan(before - 0.1);
  for (let i = 0; i < 40; i++) await page.keyboard.press('+');
  await settled(page);
  expect(await reach(page)).toBeGreaterThanOrEqual(12 - 1e-6);

  // - zooms out, and never past the farthest distance
  for (let i = 0; i < 60; i++) await page.keyboard.press('-');
  await settled(page);
  expect(await reach(page)).toBeLessThanOrEqual(60 + 1e-6);
  expect(await reach(page)).toBeGreaterThan(55);

  // Shift+ArrowLeft pans: the target moves
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => dist(await target(page), home.target)).toBeGreaterThan(0.1);

  // keys typed into a text field leave the camera alone
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'typing';
    document.body.append(input);
  });
  const resting = await settled(page);
  await page.locator('#typing').focus();
  for (const k of ['ArrowRight', 'ArrowUp', '+', '-', 'h', 'Shift+ArrowLeft']) await page.keyboard.press(k);
  const after = await settled(page);
  expect(dist(after.position, resting.position)).toBeLessThan(1e-6);
  await page.locator('#typing').blur();

  // h still goes home
  await page.keyboard.press('h');
  await expect.poll(async () => dist(await target(page), home.target)).toBeLessThan(0.05);
  await expect.poll(async () => dist((await cam(page)).position, home.position)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});

test('the edge-rule board labels all nine buildings', async ({ page }) => {
  const errors = collectErrors(page);
  await start(page, 'edge-rule');
  await expect(page.getByTestId('board').locator('canvas')).toBeVisible();
  for (const name of ['Gate', 'Edge', 'Filter', 'Web', 'API', 'Cache', 'Accounts', 'Orders', 'Database']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => window.__downtown!.canvasColors())).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('without WebGL2 the board says so instead of drawing', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await start(page, 'tutorial');
  await expect(page.getByTestId('no-webgl')).toBeVisible();
  await expect(page.getByTestId('board')).toHaveCount(0);
});
