import { expect, test } from './fixtures';

test('smoke: crear torneo, generar y confirmar una ronda', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // Keep the smoke test deterministic: no tournament from a reused browser profile
  // may hide the ADUMA creation actions on the home screen.
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/tabulacion');
  await expect(page.getByRole('heading', { level: 2, name: 'Tabulación del torneo' })).toBeVisible();
  const createSample = page.getByRole('button', { name: /Crear ensayo ADUMA/ });
  await expect(createSample).toBeVisible();
  await createSample.click();

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
