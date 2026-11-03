import { expect, test } from './fixtures';

test('smoke: crear torneo, generar y confirmar una ronda', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/tabulacion');
  await expect(page.getByRole('button', { name: 'Crear Torneo ADUMA' })).toBeVisible();

  await page.getByRole('button', { name: /Crear ensayo ADUMA/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Rondas' })).toBeVisible();

  await page.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  await expect(page.getByRole('heading', { name: 'Ronda 1 · borrador' })).toBeVisible();

  const acknowledge = page.getByLabel(/Confirmo bajo mi responsabilidad/);
  if (await acknowledge.isVisible()) await acknowledge.check();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Confirmar ronda' }).click();
  const file = await (await download).path();
  expect(file).toBeTruthy();

  await expect(page.locator('.tab-round-screen')).toContainText('frente a');
});
