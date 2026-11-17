import { expect, mockActaShortLinks, nav, seedManagerSession, test } from './fixtures';

test('un juez rellena el acta desde un enlace S8 de ocho caracteres y la mesa la recibe por WhatsApp', async ({ context, baseURL }) => {
  await mockActaShortLinks(context);
  await context.route('https://debate.example/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>Public acta link</title></head><body>Public short-link URL</body></html>' });
  });
  const desk = await context.newPage();
  desk.on('dialog', (dialog) => void dialog.accept());
  await seedManagerSession(desk);
  await desk.goto('/tabulacion');
  await desk.getByRole('button', { name: /Crear ensayo ADUMA/ }).click();

  await nav(desk, 'Reglas');
  await desk.getByLabel('Móvil de la mesa de tabulación (WhatsApp)').fill('600 11 22 33');
  await desk.getByLabel('Dirección pública de la página del acta').fill('https://debate.example');
  await expect(desk.getByText('Las actas llegarán al +34600112233.')).toBeVisible();

  await nav(desk, 'Rondas');
  await desk.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  const acknowledge = desk.getByLabel(/Confirmo bajo mi responsabilidad/);
  if (await acknowledge.isVisible()) await acknowledge.check();
  const download = desk.waitForEvent('download');
  await desk.getByRole('button', { name: 'Confirmar ronda' }).click();
  await download;

  await desk.locator('.tab-whatsapp summary').click();
  const sendPopupPromise = desk.waitForEvent('popup');
  await desk.getByRole('button', { name: 'Enviar enlace' }).first().click();
  const sendPopup = await sendPopupPromise;
  await expect.poll(() => sendPopup.url()).toMatch(/^https:\/\/wa\.me\/\d*\?text=/);
  const sendLink = sendPopup.url();
  const actaPopupPromise = desk.waitForEvent('popup');
  await desk.getByRole('button', { name: 'Abrir el acta' }).first().click();
  const actaPopup = await actaPopupPromise;
  await expect.poll(() => actaPopup.url()).toMatch(/\/acta#S8-[0-9A-HJKMNP-TV-Z]{8}$/);
  const actaUrl = actaPopup.url();
  await expect.poll(() => new URL(sendLink).searchParams.get('text') ?? '').toContain(actaUrl);
  const shortId = actaUrl.slice(actaUrl.indexOf('#S8-') + 4);
  expect(shortId).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  await actaPopup.close();
  await sendPopup.close();

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  const localActaUrl = new URL('/acta', baseURL!);
  localActaUrl.hash = 'S8-' + shortId;
  await phone.goto(localActaUrl.toString());
  await expect(phone.getByRole('heading', { level: 1 })).toContainText('Ronda 1');
  await phone.locator('.acta-option').first().click();
  const items = phone.locator('.acta-items input');
  await expect(items).toHaveCount(22);
  for (let index = 0; index < 22; index++) await items.nth(index).fill(index % 2 ? '3' : '4');
  await expect(phone.getByRole('button', { name: 'Enviar por WhatsApp' })).toBeDisabled();
  await phone.locator('.acta-options.big .acta-option').first().click();
  await phone.getByLabel('Notas del acta').fill('Sin incidencias.');
  const send = phone.getByRole('link', { name: 'Enviar por WhatsApp' });
  const waUrl = (await send.getAttribute('href'))!;
  expect(waUrl.startsWith('https://wa.me/34600112233?text=')).toBe(true);
  const message = decodeURIComponent(waUrl.split('?text=')[1]);
  expect(message).toContain('44 – 33 ítems netos');
  // ACTA2 is the judge's submitted score payload, not the shared URL format.
  expect(message).toMatch(/ACTA2-[0-9A-Za-z]+-[0-9a-f]{14}/);

  await nav(desk, 'Actas');
  await desk.locator('.tab-whatsapp-inbox summary').click();
  const box = desk.getByLabel('Mensajes de WhatsApp con actas');
  await box.fill('[10:31, 20/11/2026] Juez: ' + message.replace(/ACTA2-([0-9A-Za-z]+)-/, (_, data: string) => 'ACTA2-' + data.slice(0, 10) + (data[10] === 'A' ? 'B' : 'A') + data.slice(11) + '-'));
  await expect(desk.locator('.tab-inbox')).toContainText(/dañado|alterado/);
  await box.fill('[10:31, 20/11/2026] Juez: ' + message);
  await expect(desk.locator('.tab-inbox')).toContainText('Nueva');
  await desk.locator('.tab-inbox').getByRole('button', { name: 'Aceptar' }).click();
  await expect(desk.getByText(/Acta aceptada/)).toBeVisible();
  await expect(desk.locator('.tab-inbox')).toContainText('Ya registrada');
  await expect(desk.locator('.tab-ballot-list')).toContainText('Completa');

  await nav(desk, 'Registro');
  await expect(desk.locator('.tab-log')).toContainText('acta recibida por WhatsApp');
});
