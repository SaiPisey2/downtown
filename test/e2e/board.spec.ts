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
