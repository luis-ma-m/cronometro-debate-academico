import { expect, test } from './fixtures';

test('Tabulación se abre dentro del shell único de Gestión', async ({ page }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation');
  await expect(navigation.getByRole('button', { name: 'Tabulación' })).toBeVisible();
  await navigation.getByRole('button', { name: 'Tabulación' }).click();
  await expect(page.locator('.tab-embedded')).toBeVisible();
  await expect(page.getByText(/Tabulación local/)).toBeVisible();
});

