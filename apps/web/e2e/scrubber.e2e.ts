import { expect, test } from '@playwright/test';
import { load100k } from './helpers';

test('the scrubber pins the map moment, play moves it, and "follow the view" lets go', async ({
  page,
}) => {
  await load100k(page);
  const caption = page.getByRole('heading', { level: 2 }).filter({ hasText: 'Occupancy:' });
  const slider = page.getByRole('slider', { name: 'Map moment' });
  const follow = page.getByRole('button', { name: 'Follow the view' });
  await expect(follow).toBeDisabled();
  const atEnd = await caption.textContent();

  const min = Number(await slider.getAttribute('min'));
  await slider.fill(String(min + 600));
  await expect(caption).not.toHaveText(atEnd ?? '');
  await expect(follow).toBeEnabled();
  const pinned = await caption.textContent();

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(caption).not.toHaveText(pinned ?? '');
  await page.getByRole('button', { name: 'Pause' }).click();

  await follow.click();
  await expect(caption).toHaveText(atEnd ?? '');
});
