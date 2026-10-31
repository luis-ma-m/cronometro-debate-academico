import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function nav(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name }).click();
}

test('un juez rellena el acta en el móvil y la mesa la recibe por WhatsApp', async ({ context }) => {
  const desk = await context.newPage();
  desk.on('dialog', (dialog) => void dialog.accept());
  await desk.goto('/tabulacion');
  await desk.getByRole('button', { name: /Crear ensayo ADUMA/ }).click();

  // The desk's number, so the judge's button opens the desk's chat directly.
  await nav(desk, 'Reglas');
  await desk.getByLabel('Móvil de la mesa de tabulación (WhatsApp)').fill('600 11 22 33');
  await expect(desk.getByText('Las actas llegarán al +34600112233.')).toBeVisible();

  await nav(desk, 'Rondas');
  await desk.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  const acknowledge = desk.getByLabel(/Confirmo bajo mi responsabilidad/);
  if (await acknowledge.isVisible()) await acknowledge.check();
  const download = desk.waitForEvent('download');
  await desk.getByRole('button', { name: 'Confirmar ronda' }).click();
  await download;

  // Link for the chair of the first room.
  await desk.locator('.tab-whatsapp summary').click();
  const sendPopupPromise = desk.waitForEvent('popup');
  await desk.getByRole('button', { name: 'Enviar enlace' }).first().click();
  const sendPopup = await sendPopupPromise;
  await expect.poll(() => sendPopup.url()).toMatch(/^https:\/\/wa\.me\/\d*\?text=/);
  const sendLink = sendPopup.url();
  const actaPopupPromise = desk.waitForEvent('popup');
  await desk.getByRole('button', { name: 'Abrir el acta' }).first().click();
  const actaPopup = await actaPopupPromise;
  await expect.poll(() => actaPopup.url()).toContain('/acta#A2');
  const actaUrl = actaPopup.url();
  await expect.poll(() => new URL(sendLink).searchParams.get('text') ?? '').toContain(actaUrl);
  // WhatsApp iOS must see the entire fragment as one URL: no separators after #A2.
  expect(actaUrl).toMatch(/#A2[0-9A-Za-z]+$/);
  expect(actaUrl.slice(actaUrl.indexOf('#A2'))).not.toContain('-');

  // The judge's phone.
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(actaUrl);
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
  expect(message).toMatch(/ACTA2-[0-9A-Za-z]+-[0-9a-f]{14}/);

  // Back at the desk: paste the WhatsApp message and accept the acta.
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
