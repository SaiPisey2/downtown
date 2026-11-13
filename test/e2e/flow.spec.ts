import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const DUMMY_KEY = 'not-a-real-key-4f9c';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Every host the page sends a request to, besides the game's own. */
function collectHosts(page: Page): Set<string> {
  const hosts = new Set<string>();
  page.on('request', (r) => {
    const host = new URL(r.url()).host;
    if (host !== '127.0.0.1:4173' && host !== '') hosts.add(host);
  });
  return hosts;
}

/** Runs the simulation forward to `tick` in one step, as earlier tests do. */
async function jumpTo(page: Page, tick: number): Promise<void> {
  await page.evaluate((t) => {
    const h = window.__downtown!;
    const now = h.state().snap!.tick;
    if (t <= now) return;
    h.setSpeed((t - now) / (0.25 * 4));
    h.advance(250);
    h.setSpeed(1);
  }, tick);
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

test('title, tutorial skipped, briefing, a won run, its debrief, and a share link that replays it', async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  const errors = collectErrors(page);
  const hosts = collectHosts(page);
  await page.goto('/?test=1');

  // the title, with the city behind it
  await expect(page.getByRole('heading', { level: 1, name: 'Downtown' })).toBeFocused();
  await expect(page.getByText('The city is your production system.')).toBeVisible();
  await expect(page.getByText(/about 15 minutes, no\s+signup/i)).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

  // a key in the settings must never travel with a run
  await page.getByRole('button', { name: /^settings/i }).click();
  const settings = page.getByRole('complementary', { name: 'Settings' });
  await settings.getByLabel('Your key').fill(DUMMY_KEY);
  await expect(settings.getByText('Your key will be sent to api.anthropic.com')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);

  // first visit: Play leads to the tutorial, which can be skipped
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The slow shop' })).toBeFocused();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  const briefing = page.getByRole('heading', { level: 1, name: 'The rule that ate the city' });
  await expect(briefing).toBeFocused();
  await expect(page.getByText('Inspect buildings')).toBeVisible();
  await expect(page.getByText('Ask your team')).toBeVisible();
  await expect(page.getByText(/keep the boss updated/i)).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('banner')).toBeVisible();
  expect(await page.evaluate(() => window.__downtown!.state().screen)).toBe('play');

  // win the case through the hook's inputs
  await page.evaluate(() => window.__downtown!.setAutoDebrief(true));
  await jumpTo(page, 250);
  await page.evaluate(() => window.__downtown!.state().update('investigating'));
  await jumpTo(page, 300);
  await page.evaluate(() => window.__downtown!.state().observe('graph:edge.saturation'));
  await jumpTo(page, 360);
  await page.evaluate(() => window.__downtown!.state().observe('changes'));
  await jumpTo(page, 480);
  await page.evaluate(() => window.__downtown!.state().act('filter_off'));
  await jumpTo(page, 490);
  await page.evaluate(() => window.__downtown!.state().update('cause_found'));
  await jumpTo(page, 1200);
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().snap!.status)).toBe('won');
  await expect(page.getByRole('button', { name: 'See debrief' })).toBeVisible();

  // the debrief opens by itself after the beat
  const head = page.getByRole('heading', { level: 1, name: 'You brought the city back' });
  await expect(head).toBeVisible({ timeout: 6_000 });
  await expect(head).toBeFocused();
  for (const name of ['Detection', 'Recovery', 'Traffic saved', 'No harm done', 'Updates']) {
    await expect(page.getByRole('meter', { name })).toBeVisible();
  }
  await expect(page.getByText('How quickly you found the first key clue')).toBeVisible();
  await expect(page.getByText('Keeping the boss informed, honestly')).toBeVisible();
  const total = Number(await page.locator('.score-big').evaluate((el) => el.firstChild!.textContent));
  expect(total).toBeGreaterThan(50);
  const timeline = page.getByRole('list').filter({ hasText: 'The city recovered' });
  await expect(timeline.getByRole('listitem').first()).toContainText('04:00');
  await expect(timeline).toContainText('You started: Switch the filter off everywhere');
  const source = page.getByRole('link', { name: /Cloudflare/ });
  await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(source).toContainText('2 July 2019');
  await expect(page.getByText(/every number in this case are made\s+up/)).toBeVisible();
  // live characters are off: no reviewer
  await expect(page.getByText(/Reviewer’s comments/)).toHaveCount(0);

  // the card saves as an image
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save image' }).click();
  expect((await download).suggestedFilename()).toMatch(/^downtown-edge-rule-\d+\.png$/);

  // the link
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied.', { exact: false })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/#r=[A-Za-z0-9_-]+$/);
  // origin and path only: the test switch in this page's address is not passed on
  expect(url).not.toContain('?');
  expect(url).not.toContain('test=1');
  expect(url).not.toContain(DUMMY_KEY);
  expect(Buffer.from(url.split('#r=')[1]!, 'base64url').toString('utf8')).not.toContain(DUMMY_KEY);
  expect(await page.evaluate(() => JSON.stringify(window.__downtown!.state(), (_k, v) => (typeof v === 'function' ? undefined : v)))).not.toContain(DUMMY_KEY);
  expect(url.length).toBeLessThan(2_000);

  // opened in a new page: the replay, then its debrief with the same total
  const viewer = await context.newPage();
  const viewerErrors = collectErrors(viewer);
  const viewerHosts = collectHosts(viewer);
  // the viewer gets the test hook added, so the test can read its state
  await viewer.goto(url.replace('#r=', '?test=1#r='));
  await expect(viewer.getByRole('status').filter({ hasText: 'Watching a replay' })).toBeVisible();
  expect(await viewer.evaluate(() => window.__downtown!.state().replaying)).toBe(true);
  // the controls are off while it plays
  await expect(viewer.getByRole('banner').getByRole('button', { name: /hint/i })).toBeDisabled();
  await viewer.evaluate(() => {
    window.__downtown!.setAutoDebrief(true);
    window.__downtown!.setSpeed(6);
  });
  await expect(viewer.getByRole('heading', { level: 1, name: 'You brought the city back' })).toBeVisible({ timeout: 40_000 });
  await expect(viewer.locator('.score-big')).toContainText(String(total));
  await viewer.getByRole('button', { name: 'Play it yourself' }).click();
  await expect(viewer.getByRole('heading', { level: 1, name: 'The rule that ate the city' })).toBeVisible();
  expect(new URL(viewer.url()).hash).toBe('');
  expect(viewerErrors).toEqual([]);
  expect([...viewerHosts]).toEqual([]);

  expect(errors).toEqual([]);
  expect([...hosts]).toEqual([]);
});

test('skip to result ends on the same debrief', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  const data = b64(JSON.stringify({
    v: 1, c: 'tutorial', cv: 1, s: 7,
    i: [[13, 'o', 'changes'], [14, 'a', 'rollback'], [15, 'a', 'rollback'], [16, 'o', '']],
  }));
  await page.goto(`/?test=1#r=${data}`);
  await expect(page.getByRole('status').filter({ hasText: 'Watching a replay' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip to result' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'You brought the city back' })).toBeVisible();
  const want = await page.evaluate(() => {
    const s = window.__downtown!.state();
    return s.run!.inputs.length;
  });
  expect(want).toBe(4);
  await page.getByRole('button', { name: 'Back to title' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Downtown' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(errors).toEqual([]);
});

test('bad replay links land on the title with a plain notice and no console error', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?test=1#r=%%%');
  await expect(page.getByRole('heading', { level: 1, name: 'Downtown' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('That replay link is not valid.');

  await page.goto(`/?test=1#r=${b64(JSON.stringify({ v: 1, c: 'no-such-case', cv: 1, s: 1, i: [] }))}`);
  await page.reload();
  await expect(page.getByRole('alert')).toHaveText('That replay is for a case this version does not have.');

  await page.goto(`/?test=1#r=${'A'.repeat(20_000)}`);
  await page.reload();
  await expect(page.getByRole('alert')).toHaveText('That replay link is not valid.');
  expect(errors).toEqual([]);
});

test('after the tutorial is skipped, Play goes straight to the case; Tutorial still opens it', async ({ page }) => {
  await page.goto('/?test=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The rule that ate the city' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip tutorial' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Tutorial' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The slow shop' })).toBeVisible();
});

test('a browser that blocks sessionStorage still plays', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/?test=1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The rule that ate the city' })).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('banner')).toBeVisible();
  expect(errors).toEqual([]);
});
