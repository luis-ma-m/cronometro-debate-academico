import { confirmOpenDraft, expect, fillActaOnPhone, guardNetwork, nav, openAdumaRehearsal, test } from './fixtures';

test('sin conexión: la mesa hace una ronda entera y el juez solo necesita red para abrir el enlace', async ({ context, page }) => {
  await page.goto('/tabulacion');
  await expect(page.getByRole('button', { name: 'Crear Torneo ADUMA' })).toBeVisible();
  await context.setOffline(true);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /Crear ensayo ADUMA/ }).click();
  await page.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  await confirmOpenDraft(page);
  await expect(page.locator('.tab-round-screen')).toContainText('frente a');
  await page.locator('.tab-whatsapp summary').click();
  const actaUrl = (await page.getByRole('link', { name: /Abrir el acta de/ }).first().getAttribute('href'))!;

  await context.setOffline(false);
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(actaUrl);
  await expect(phone.getByRole('heading', { level: 1 })).toContainText('Ronda 1');
  await context.setOffline(true);
  const message = await fillActaOnPhone(phone);
  await phone.reload().catch(() => undefined);
  expect(message).toMatch(/ACTA2-/);

  await nav(page, 'Actas');
  await page.locator('.tab-whatsapp-inbox summary').click();
  await page.getByLabel('Mensajes de WhatsApp con actas').fill(message);
  await page.locator('.tab-inbox').getByRole('button', { name: 'Aceptar' }).click();
  await expect(page.locator('.tab-inbox')).toContainText('Ya registrada');
  await nav(page, 'Rondas');
  await page.getByRole('button', { name: 'Simular resultados' }).click();
  await page.getByRole('button', { name: 'Nueva ronda (Ronda 2)' }).click();
  await confirmOpenDraft(page);
  await nav(page, 'Clasificación');
  await expect(page.locator('.tab-standings').first()).toContainText('Ítems');
  await nav(page, 'Registro');
  await page.getByRole('button', { name: 'Verificar registro' }).click();
  await expect(page.getByText(/El registro verifica/)).toBeVisible();
  await context.setOffline(false);
});

test('otro portátil continúa el torneo importando la copia exportada, con su registro', async ({ page, browser, baseURL }) => {
  await openAdumaRehearsal(page);
  await page.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  await confirmOpenDraft(page);
  await page.getByRole('button', { name: 'Simular resultados' }).click();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar copia' }).click();
  const copy = await (await exported).path();

  const spare = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const blocked = await guardNetwork(spare, baseURL!);
  const laptop = await spare.newPage();
  laptop.on('dialog', (dialog) => void dialog.accept());
  await laptop.goto('/tabulacion');
  await laptop.locator('input[type=file]').setInputFiles(copy);
  await expect(laptop.getByText(/Copia importada\. Incluye \d+ entradas de registro/)).toBeVisible();
  await nav(laptop, 'Actas');
  await expect(laptop.locator('.round-tabs button', { hasText: 'Ronda 1' }).locator('.tab-tab-count')).toHaveText('10/10');
  await nav(laptop, 'Registro');
  await laptop.getByRole('button', { name: 'Verificar registro' }).click();
  await expect(laptop.getByText(/El registro verifica/)).toBeVisible();
  await expect(laptop.locator('.tab-log')).toContainText('Importada una copia');
  await expect(laptop.locator('.tab-log')).toContainText('Ronda 1 confirmada');
  await nav(laptop, 'Rondas');
  await laptop.getByRole('button', { name: 'Nueva ronda (Ronda 2)' }).click();
  await confirmOpenDraft(laptop);
  await expect(laptop.locator('.tab-round-screen')).toContainText('Ronda 2');
  expect(blocked).toEqual([]);
  await spare.close();
});

test('con el navegador lleno avisa sin romperse y guarda en cuanto hay espacio', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/tabulacion');
  await expect(page.getByRole('button', { name: 'Crear Torneo ADUMA' })).toBeVisible();
  await page.evaluate(() => {
    let index = 0;
    for (const size of [512 * 1024, 32 * 1024, 1024, 32]) {
      const chunk = 'x'.repeat(size);
      try {
        for (;;) localStorage.setItem('relleno-' + index++, chunk);
      } catch { /* Full at this size: try smaller chunks. */ }
    }
  });
  await page.getByRole('button', { name: 'Crear Torneo ADUMA' }).click();
  await expect(page.getByText(/No queda espacio en el almacenamiento del navegador/)).toBeVisible();
  await nav(page, 'Reglas');
  await expect(page.getByRole('heading', { level: 2, name: 'Reglas del torneo' })).toBeVisible();

  // Nothing was lost in memory: after freeing space, retrying saves it.
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('relleno-')) localStorage.removeItem(key); });
  await page.getByRole('button', { name: 'Reintentar el guardado' }).click();
  await expect(page.getByText('Guardado correctamente.')).toBeVisible();
  await expect(page.getByText(/No queda espacio/)).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('V Torneo Nacional ADUMA');
});

test('si el código de la página no llega a descargarse, lo dice en vez de quedarse en blanco', async ({ page }) => {
  await page.route(/TabulationApp|JudgeActaApp/, (route) => route.abort());
  await page.goto('/tabulacion');
  await expect(page.getByRole('alert')).toContainText('No se ha podido cargar la tabulación');
  await expect(page.getByRole('button', { name: 'Recargar' })).toBeVisible();
  await page.goto('/acta#A1-x');
  await expect(page.getByRole('alert')).toContainText('No se ha podido cargar el acta');
});
