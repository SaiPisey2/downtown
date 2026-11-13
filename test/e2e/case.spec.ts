import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Every request the page makes to anywhere but its own origin. */
function collectForeign(page: Page): string[] {
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== ORIGIN) foreign.push(r.url());
  });
  return foreign;
}

/** Title, tutorial skipped, briefing, Start: the way a first-time player reaches the case. */
async function startFromTitle(page: Page): Promise<void> {
  await page.goto('/?test=1');
  await expect(page.getByRole('heading', { level: 1, name: 'Downtown' })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The rule that ate the city' })).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('banner')).toBeVisible();
  await page.evaluate(() => window.__downtown!.state().setPaused(true, 'user'));
}

/** Moves time straight to `tick` and leaves the run paused there; the test hook is used for time only. */
async function jumpTo(page: Page, tick: number): Promise<void> {
  await page.evaluate((target) => {
    const h = window.__downtown!;
    const now = h.state().snap!.tick;
    h.state().setPaused(false);
    if (target > now) {
      h.setSpeed((target - now) / (0.25 * 4));
      h.advance(250);
      h.setSpeed(1);
    }
    h.state().setPaused(true, 'user');
  }, tick);
}

const setRunning = (page: Page, on: boolean) =>
  page.evaluate((run) => window.__downtown!.state().setPaused(!run, 'user'), on);
const status = (page: Page) => page.evaluate(() => window.__downtown!.state().snap!.status);

test('edge-rule played to a win through the interface', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const foreign = collectForeign(page);
  await startFromTitle(page);

  // the rules update lands at 240 and the edge runs out of CPU at 242
  await jumpTo(page, 250);
  const clueToast = page.getByRole('status').filter({ hasText: 'Clue found' });

  // look at the edge's graphs while the clock runs, until the clue is noted
  await page.getByRole('button', { name: 'Edge', exact: true }).click();
  const edge = page.getByRole('complementary', { name: /edge building/i });
  await expect(edge.getByRole('img', { name: /saturation/i })).toBeVisible();
  await setRunning(page, true);
  await expect(clueToast.filter({ hasText: /out of CPU/i })).toBeVisible({ timeout: 10_000 });
  await setRunning(page, false);
  await page.keyboard.press('Escape');
  await expect(edge).toHaveCount(0);

  // the city-wide change log shows the rules update
  const hud = page.getByRole('banner');
  await hud.getByRole('button', { name: /change log/i }).click();
  const changes = page.getByRole('complementary', { name: /change log/i });
  await expect(changes).toContainText('rules update 412');
  await expect(clueToast.filter({ hasText: /update 412/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(changes).toHaveCount(0);

  // ask the network teammate about the traffic
  await hud.getByRole('button', { name: /^team/i }).click();
  const chat = page.getByRole('complementary', { name: /team chat/i });
  await chat.getByRole('button', { name: /nadia/i }).click();
  await chat.getByRole('button', { name: 'Is this an attack? How is the traffic?' }).click();
  await expect(chat.getByRole('log', { name: /nadia/i })).toContainText('Volume is normal. Same sources as yesterday.');
  await expect(clueToast.filter({ hasText: /not look like an attack/i })).toBeVisible();

  // one honest update for the boss
  const honest = 'Many visitors are seeing errors. We are looking into it and will post again soon.';
  await chat.getByRole('button', { name: /ruth/i }).click();
  await chat.getByRole('button', { name: honest }).click();
  await expect(chat.getByRole('log', { name: /ruth/i }).getByRole('listitem').last()).toContainText(honest);

  // switch the filter off from the Filter building's Actions tab, and confirm
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const filter = page.getByRole('complementary', { name: /filter building/i });
  await filter.getByRole('tab', { name: 'Actions' }).click();
  await filter.getByRole('button', { name: /switch the filter off everywhere/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toHaveCount(0);

  // run time forward: the fix lands, the city holds steady, the run is won
  await jumpTo(page, 1200);
  await expect.poll(() => status(page)).toBe('won');
  await page.getByRole('button', { name: 'See debrief' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'You brought the city back' })).toBeVisible();
  const total = Number(await page.locator('.score-big').evaluate((el) => el.firstChild!.textContent));
  expect(total).toBeGreaterThan(70);

  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test('edge-rule left alone is lost', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  const foreign = collectForeign(page);
  await startFromTitle(page);

  await jumpTo(page, 3600);
  await expect.poll(() => status(page)).toBe('lost');
  await page.getByRole('button', { name: 'See debrief' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The city went down' })).toBeVisible();

  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test('the first case holds at least 30 frames per second', async ({ page }) => {
  // software rendering says nothing about real frame rates; HEADED=1 runs this on the real GPU
  test.skip(process.env.HEADED !== '1', 'needs HEADED=1 and a real GPU');
  test.setTimeout(60_000);
  await startFromTitle(page);
  await jumpTo(page, 250);
  await setRunning(page, true);
  await page.waitForTimeout(5_000);
  expect(await page.evaluate(() => window.__downtown!.fps())).toBeGreaterThanOrEqual(30);
});
