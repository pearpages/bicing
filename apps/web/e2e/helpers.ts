import { expect, type Locator, type Page } from '@playwright/test';

/** Loads 100k synthetic readings (seeded, P19): small enough for the worker to answer at once. */
export async function load100k(page: Page, lang: 'en' | 'ca' = 'en'): Promise<void> {
  await page.goto(`/?lang=${lang}`);
  // The size controls are disabled while the default dataset loads.
  const size = page.getByRole('radio', { name: '100k', exact: true });
  await expect(size).toBeEnabled({ timeout: 20_000 });
  await size.check();
  // Seed 42 at 100k: 99,899 readings over 24 hours.
  await expect(page.locator('header p').first()).toContainText(/99[.,]899 /);
  // The chart has drawn (T3.4 once shipped a chart that never did).
  await expect(
    page.getByText(/Waiting for the first frame|Esperant el primer fotograma/),
  ).toBeHidden();
  // The unfiltered counts are in: every reading passes.
  await expect.poll(() => passing(page)).toMatchObject({ filtered: false });
}

/** "N of M readings pass the filters", as numbers. */
export async function passing(
  page: Page,
): Promise<{ passing: number; rows: number; filtered: boolean }> {
  const text = (await filterPanel(page).getByRole('status').textContent()) ?? '';
  const [passingText = '', rowsText = ''] = text.match(/[\d.,]+/g) ?? [];
  const toNumber = (s: string) => Number(s.replace(/[.,]/g, ''));
  const result = { passing: toNumber(passingText), rows: toNumber(rowsText) };
  return { ...result, filtered: result.passing < result.rows };
}

export const filterPanel = (page: Page): Locator =>
  page.locator('section').filter({ has: page.locator('.bp-histogram') });

/** A real mouse drag across a fraction [from, to] of an element's width, at mid-height. */
export async function drag(
  page: Page,
  target: Locator,
  from: number,
  to: number,
  options: { shift?: boolean } = {},
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to drag on');
  const y = box.y + box.height / 2;
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y, { steps: 12 });
  await page.mouse.up();
  if (options.shift) await page.keyboard.up('Shift');
}
