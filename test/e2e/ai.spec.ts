import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DUMMY_KEY = 'not-a-real-key';
const QUESTION = 'Is anything weird about the traffic?';
const REPLY = ['Volume ', 'is normal, ', 'same sources as yesterday.'];
const BUSY = 'Give me a minute, I am in the middle of something.';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // the browser logs a failed request itself; the 401 below is one on purpose
    if (msg.type() === 'error' && !msg.text().includes('401')) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Every host the page sends a request to. */
function collectHosts(page: Page): Set<string> {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  return hosts;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access',
  'access-control-allow-methods': 'POST',
};

function events(texts: string[]): string {
  const ev = (name: string, data: object) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;
  return [
    ev('message_start', { message: { id: 'msg_test', role: 'assistant', content: [] } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ...texts.map((text) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })),
    ev('content_block_stop', { index: 0 }),
    ev('message_stop', {}),
  ].join('');
}

interface Seen {
  headers: Record<string, string>;
  body: { model: string; messages: { role: string; content: string }[]; system: string };
}

/** Answers the provider endpoint with whatever `next` says; nothing leaves the machine. */
async function intercept(page: Page, next: () => { status: number; body: string }): Promise<Seen[]> {
  const seen: Seen[] = [];
  await page.route(ENDPOINT, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.push({ headers: req.headers(), body: req.postDataJSON() });
    const { status, body } = next();
    await route.fulfill({ status, headers: { ...CORS, 'content-type': status === 200 ? 'text/event-stream' : 'application/json' }, body });
  });
  return seen;
}

async function start(page: Page): Promise<void> {
  await page.goto('/?test=1');
  await page.evaluate(() => window.__downtown!.state().start('edge-rule'));
  await expect.poll(() => page.evaluate(() => window.__downtown!.fps()).catch(() => -1)).toBeGreaterThanOrEqual(0);
  await page.evaluate(() => {
    const h = window.__downtown!;
    h.setSpeed(300 / (0.25 * 4));
    h.advance(250);
    h.setSpeed(1);
    h.state().setPaused(true, 'user');
  });
}

async function openSettings(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: /^settings/i }).click();
  return page.getByRole('complementary', { name: 'Settings' });
}

async function chatWithNadia(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: /^team/i }).click();
  const chat = page.getByRole('complementary', { name: /team chat/i });
  await chat.getByRole('button', { name: /nadia/i }).click();
  return { chat, log: chat.getByRole('log', { name: /nadia/i }) };
}

test('live characters: a typed question gets a streamed reply from the intercepted provider, shown as plain text', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  const hosts = collectHosts(page);
  const replies = [events(REPLY), events(['Look: <b>bold</b> ', '‮desrever', ' <img src=x onerror=alert(1)>'])];
  const seen = await intercept(page, () => ({ status: 200, body: replies.shift() ?? events(['?']) }));
  await start(page);

  // off by default: no text box, and the switch waits for a key
  const settings = await openSettings(page);
  await expect(settings.getByText('Your key stays in this tab and is sent only to the provider you chose.')).toBeVisible();
  await expect(settings.getByText(/cost you money/i)).toBeVisible();
  const key = settings.getByLabel('Your key');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveAttribute('autocomplete', 'off');
  const live = settings.getByRole('switch', { name: 'Use live characters' });
  await expect(live).toBeDisabled();
  await expect(settings.getByLabel('Chat model')).toHaveValue('claude-haiku-5-5');
  await expect(settings.getByLabel('Review model')).toHaveValue('claude-opus-5-5');

  // OpenAI-compatible: a plain-http base URL to another machine is refused in words
  await settings.getByLabel('Provider').selectOption('openai');
  await settings.getByLabel('Base URL').fill('http://example.com/v1');
  await expect(settings.getByRole('alert')).toContainText('https://');
  await settings.getByLabel('Base URL').fill('http://127.0.0.1:11434/v1');
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await settings.getByLabel('Provider').selectOption('anthropic');

  await key.fill(DUMMY_KEY);
  await expect(live).toBeEnabled();
  await live.check();
  await expect(page.getByRole('banner').getByRole('button', { name: /^settings, live characters on/i })).toBeVisible();

  const { chat, log } = await chatWithNadia(page);
  const box = chat.getByRole('textbox', { name: /message nadia/i });
  await box.fill(QUESTION);
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(log.getByRole('listitem').filter({ hasText: QUESTION })).toHaveCount(1);
  await expect(log.getByRole('listitem').last()).toContainText(REPLY.join(''));
  await expect(box).toHaveValue('');

  expect(seen).toHaveLength(1);
  expect(seen[0]!.headers['x-api-key']).toBe(DUMMY_KEY);
  expect(seen[0]!.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(seen[0]!.body.model).toBe('claude-haiku-5-5');
  expect(seen[0]!.body.messages.at(-1)).toEqual({ role: 'user', content: QUESTION });
  // no clue for free text, and the stakeholder still gets buttons only
  expect(await page.evaluate(() => window.__downtown!.state().found)).not.toContain('volume_normal');

  // markup and a direction override arrive as literal characters, never as elements
  const before = await log.locator('*').count();
  await box.fill('And now?');
  await box.press('Enter');
  const last = log.getByRole('listitem').last();
  await expect(last).toContainText('Look: <b>bold</b> desrever <img src=x onerror=alert(1)>');
  await expect(last.locator('.typing')).toHaveCount(0);
  expect(await last.textContent()).not.toContain('‮');
  await expect(log.locator('b, img')).toHaveCount(0);
  const li = await log.getByRole('listitem').first().locator('*').count();
  expect(await log.locator('*').count()).toBe(before + 2 * (li + 1));

  await chat.getByRole('button', { name: /ruth/i }).click();
  await expect(chat.getByRole('textbox')).toHaveCount(0);

  expect([...hosts].filter((h) => h !== '127.0.0.1:4173')).toEqual(['api.anthropic.com']);
  expect(errors).toEqual([]);
});

test('a rejected key gives the busy line and one notice; without "keep for this tab" a reload forgets the key', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await intercept(page, () => ({ status: 401, body: '{"type":"error","error":{"type":"authentication_error"}}' }));
  await start(page);
  const settings = await openSettings(page);
  await settings.getByLabel('Your key').fill(DUMMY_KEY);
  await settings.getByRole('switch', { name: 'Use live characters' }).check();

  const { chat, log } = await chatWithNadia(page);
  await chat.getByRole('textbox', { name: /message nadia/i }).fill(QUESTION);
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(log.getByRole('listitem').filter({ hasText: BUSY })).toHaveCount(1);
  const notice = log.getByRole('listitem').filter({ hasText: 'Your key was rejected — using scripted lines.' });
  await expect(notice).toHaveCount(1);
  await expect(notice).toHaveClass(/msg-system/);
  // questions by id still work, scripted, and find their clue
  await chat.getByRole('button', { name: 'Is this an attack? How is the traffic?' }).click();
  await expect(log.getByRole('listitem').last()).toContainText('Volume is normal. Same sources as yesterday.');
  await expect.poll(() => page.evaluate(() => window.__downtown!.state().found)).toContain('volume_normal');
  await expect(notice).toHaveCount(1);

  await page.reload();
  await start(page);
  await expect((await openSettings(page)).getByLabel('Your key')).toHaveValue('');
  expect(await page.evaluate(() => window.sessionStorage.length + window.localStorage.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('with "keep for this tab" the key survives a reload, and Forget key clears it', async ({ page }) => {
  test.setTimeout(60_000);
  await start(page);
  let settings = await openSettings(page);
  await settings.getByLabel('Your key').fill(DUMMY_KEY);
  await settings.getByLabel('Keep for this tab').check();
  await page.reload();
  await start(page);
  settings = await openSettings(page);
  await expect(settings.getByLabel('Your key')).toHaveValue(DUMMY_KEY);
  await settings.getByRole('button', { name: 'Forget key' }).click();
  await expect(settings.getByLabel('Your key')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(window.sessionStorage))).not.toContain(DUMMY_KEY);
});
