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

test('todas las pantallas: sin errores en consola, controles con nombre y sin desbordes', async ({ page }) => {
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

  // Without a manager session the short-only policy must disable link actions.
  await nav(page, 'Rondas');
  await page.locator('.tab-whatsapp summary').click();
  await expect(page.getByRole('button', { name: 'Abrir el acta' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enviar enlace' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copiar todos los enlaces para el grupo de jueces' })).toBeDisabled();
  await expect(page.locator('.tab-whatsapp')).toContainText('No se envían enlaces autocontenidos como alternativa.');

  expect(problems).toEqual([]);
});
