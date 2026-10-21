import { expect, test, type Page } from '@playwright/test';
import { drag, filterPanel, load100k, passing } from './helpers';

const histogram = (page: Page, index: 0 | 1) =>
  page.locator('.bp-histogram__brush .overlay').nth(index);
const timeBrush = (page: Page) => page.locator('.bp-chart__brush .overlay');

test.beforeEach(async ({ page }) => {
  await load100k(page);
});

test('brushing occupancy filters the readings, and "clear filters" brings them back', async ({
  page,
}) => {
  const clear = filterPanel(page).getByRole('button', { name: 'Clear filters' });
  await expect(clear).toBeDisabled();
  await drag(page, histogram(page, 1), 0.02, 0.3);
  await expect.poll(() => passing(page)).toMatchObject({ filtered: true });
  const { passing: brushed, rows } = await passing(page);
  expect(brushed).toBeGreaterThan(0);

  // A second brush narrows it further: the views filter each other.
  await drag(page, histogram(page, 0), 0.3, 0.6);
  await expect.poll(async () => (await passing(page)).passing).toBeLessThan(brushed);

  await clear.click();
  await expect.poll(() => passing(page)).toEqual({ passing: rows, rows, filtered: false });
  await expect(clear).toBeDisabled();
  await expect(page.locator('.bp-histogram__brush .selection').first()).toBeHidden();
});

test('shift + drag on the chart brushes time; a plain drag pans and filters nothing', async ({
  page,
}) => {
  await drag(page, timeBrush(page), 0.3, 0.5);
  // Give the worker a moment: a plain drag must not have sent a filter.
  await page.waitForTimeout(300);
  expect((await passing(page)).filtered).toBe(false);

  await drag(page, timeBrush(page), 0.3, 0.5, { shift: true });
  await expect.poll(() => passing(page)).toMatchObject({ filtered: true });
  const { passing: brushed, rows } = await passing(page);
  // A fifth of the plot's width is selected; allow for uneven readings across the day.
  expect(brushed / rows).toBeGreaterThan(0.1);
  expect(brushed / rows).toBeLessThan(0.35);
});

test('clicking stations on the map picks them; clicking empty map drops the pick', async ({
  page,
}) => {
  const map = page.locator('.bp-map');
  const box = await map.boundingBox();
  if (!box) throw new Error('no map');
  // Find a station the way a person does: move until the hover ring shows.
  const ring = page.locator('.bp-map svg g').first();
  let found = false;
  for (let i = 1; i < 10 && !found; i++) {
    for (let j = 1; j < 10 && !found; j++) {
      await page.mouse.move(box.x + (box.width * i) / 10, box.y + (box.height * j) / 10);
      await page.waitForTimeout(40);
      found = (await ring.getAttribute('visibility')) === 'visible';
    }
  }
  expect(found).toBe(true);
  await page.mouse.down();
  await page.mouse.up();
  await expect(filterPanel(page).getByRole('status')).toContainText('1 station picked');
  // The pick shows at once; the worker's counts follow. One station of 347 holds a small share.
  const { rows } = await passing(page);
  await expect.poll(async () => (await passing(page)).passing).toBeLessThan(rows / 50);
  expect((await passing(page)).passing).toBeGreaterThan(0);

  // The map's corner is padding, never a station.
  await page.mouse.click(box.x + 2, box.y + 2);
  await expect.poll(() => passing(page)).toMatchObject({ filtered: false });
});

test('the panel speaks Catalan', async ({ page }) => {
  await load100k(page, 'ca');
  const panel = filterPanel(page);
  await expect(panel.getByRole('button', { name: 'Esborra els filtres' })).toBeVisible();
  await expect(panel.getByRole('status')).toContainText('lectures passen els filtres');
  await expect(panel.getByText('Hora del dia')).toBeVisible();
});
