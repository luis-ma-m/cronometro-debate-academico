import type { Page } from '@playwright/test';
import { confirmOpenDraft, expect, nav, openAdumaRehearsal, test } from './fixtures';

/** Basic checks of a screen: every visible control has a name and nothing overflows horizontally. */
async function audit(page: Page, label: string) {
  const report = await page.evaluate(() => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const nameOf = (element: HTMLElement) => {
      const direct = element.getAttribute('aria-label') || element.getAttribute('title');
      if (direct) return direct;
      if (element.id) {
        const label = document.querySelector('label[for="' + element.id + '"]');
        if (label?.textContent?.trim()) return label.textContent;
      }
      const wrapping = element.closest('label');
      if (wrapping?.textContent?.trim()) return wrapping.textContent;
      if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) return element.textContent?.trim() ?? '';
      return (element as HTMLInputElement).placeholder ?? '';
    };
    const unnamed = [...document.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=file]), select, textarea, button, a[href]')]
      .filter(visible).filter((element) => !nameOf(element).trim()).map((element) => element.outerHTML.slice(0, 140));
    return { unnamed, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  expect(report.unnamed, label + ': controles sin nombre accesible').toEqual([]);
  expect(report.overflow, label + ': desborde horizontal').toBeLessThanOrEqual(1);
}

test('todas las pantallas: sin errores en consola, controles con nombre y sin desbordes', async ({ page, context }) => {
  const problems: string[] = [];
  const watch = (target: Page) => {
    target.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') problems.push(message.type() + ': ' + message.text().slice(0, 200)); });
    target.on('pageerror', (error) => problems.push('pageerror: ' + error.message));
  };
  watch(page);
  await page.goto('/tabulacion');
  await expect(page.getByRole('button', { name: 'Crear Torneo ADUMA' })).toBeVisible();
  await audit(page, 'Inicio vacío');
  await openAdumaRehearsal(page);
  await page.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  await audit(page, 'Borrador');
  await confirmOpenDraft(page);
  await audit(page, 'Pantalla de ronda');
  await page.getByRole('button', { name: 'Simular resultados' }).click();
  await page.locator('.tab-whatsapp summary').click();
  await audit(page, 'Rondas con enlaces');

  for (const view of ['Inicio', 'Reglas', 'Participantes', 'Actas', 'Clasificación', 'Registro']) {
    await nav(page, view);
    await audit(page, view);
  }
  await nav(page, 'Participantes');
  for (const tab of ['Jueces', 'Incompatibilidades', 'Salas']) {
    await page.locator('.round-tabs').getByRole('button', { name: new RegExp('^' + tab) }).click();
    await audit(page, 'Participantes · ' + tab);
  }
  await page.locator('.round-tabs').getByRole('button', { name: /^Equipos/ }).click();
  await page.locator('.tab-entity').first().getByRole('button', { name: /integrantes/ }).click();
  await audit(page, 'Equipo desplegado');
  await nav(page, 'Actas');
  await page.locator('.tab-ballot-list li button').first().click();
  await page.locator('.tab-whatsapp-inbox summary').click();
  await audit(page, 'Acta abierta');
  // The two speakers tables must never spill over each other, at any desktop width.
  for (const width of [1280, 1440, 1600, 1680, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    const spill = await page.evaluate(() => [...document.querySelectorAll('.tab-speaker-blocks > div')]
      .map((block) => (block.querySelector('table')?.getBoundingClientRect().right ?? 0) - block.getBoundingClientRect().right));
    expect(Math.max(...spill), 'tabla de oradores a ' + width + ' px').toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav(page, 'Inicio');
  await page.getByRole('button', { name: 'Comprobar ahora' }).click();
  await expect(page.getByText(/Todo en orden|equipos activos/).first()).toBeVisible();
  await audit(page, 'Diagnóstico');
  await nav(page, 'Clasificación');
  await page.getByRole('button', { name: 'Proyectar' }).first().click();
  await expect(page.getByText('La clasificación se publicará al terminar la fase clasificatoria.')).toBeVisible();
  await audit(page, 'Proyección a ciegas');
  await page.keyboard.press('Escape');

  // The judges' page on a phone, and a broken link.
  await nav(page, 'Rondas');
  await page.locator('.tab-whatsapp summary').click();
  const actaRows = page.locator('.tab-whatsapp tbody tr');
  const openActaUrl = async (index: number) => {
    const popupPromise = page.waitForEvent('popup');
    await actaRows.nth(index).getByRole('button', { name: 'Abrir el acta' }).click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toContain('/acta#A2');
    const url = popup.url();
    await popup.close();
    return url;
  };
  const actaUrl = await openActaUrl(0);
  const otherUrl = await openActaUrl(1);
  const phone = await context.newPage();
  watch(phone);
  await phone.setViewportSize({ width: 360, height: 740 });
  await phone.goto(actaUrl);
  await expect(phone.getByRole('heading', { level: 1 })).toContainText('Ronda 1');
  await audit(phone, 'Acta en el móvil');
  // Another link in the same tab only changes the hash: the page must switch to that debate.
  await phone.locator('.acta-option').first().click();
  await phone.goto(otherUrl);
  await expect(phone.getByRole('heading', { level: 1 })).toContainText('Aula 2');
  await expect(phone.locator('.acta-option input').first()).not.toBeChecked();
  await phone.goto(actaUrl);
  await expect(phone.getByRole('heading', { level: 1 })).toContainText('Aula 1');
  await expect(phone.locator('.acta-option input').first()).toBeChecked();
  await phone.goto(actaUrl.slice(0, actaUrl.length - 30));
  await expect(phone.getByText(/enlace del acta está incompleto o dañado/)).toBeVisible();
  await audit(phone, 'Enlace roto');

  expect(problems).toEqual([]);
});
