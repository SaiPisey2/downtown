import { expect, test } from '@playwright/test';

test('app loads with title and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Downtown');
  await expect(page.getByTestId('app')).toBeVisible();
  expect(errors).toEqual([]);
});
