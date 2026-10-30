import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

/**
 * Blocks API/data traffic and external servers. The health probe is stubbed as
 * unavailable: it is expected control-plane traffic, not a dependency for
 * offline operation. This keeps offline tests deterministic without hiding
 * accidental reads or writes to the backend.
 */
export async function guardNetwork(context: BrowserContext, baseURL: string): Promise<string[]> {
  const origin = new URL(baseURL).origin;
  const forbidden: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/api' && url.searchParams.get('action') === 'health' && route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Backend intentionally unavailable in this offline test.' } }),
      });
      return;
    }
    if (url.origin !== origin || url.pathname.startsWith('/api')) {
      forbidden.push(route.request().method() + ' ' + url.href.slice(0, 120));
      await route.abort();
      return;
    }
    await route.continue();
  });
  return forbidden;
}

/** Every test fails if a page tries to access backend data or another server. */
export const test = base.extend<{ noBackend: void }>({
  noBackend: [async ({ context, baseURL }, use) => {
    const forbidden = await guardNetwork(context, baseURL!);
    await use();
    expect(forbidden, 'peticiones de datos a la API o a otros servidores').toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function nav(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name }).click();
}

export async function openAdumaRehearsal(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/tabulacion');
  await page.getByRole('button', { name: /Crear ensayo ADUMA/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Rondas' })).toBeVisible();
}

/** Confirms the open draft, accepting its warnings, and returns the path of the ZIP it downloads. */
export async function confirmOpenDraft(page: Page): Promise<string> {
  const acknowledge = page.getByLabel(/Confirmo bajo mi responsabilidad/);
  if (await acknowledge.isVisible()) await acknowledge.check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Confirmar ronda' }).click();
  return (await download).path();
}

/** Fills the judge's page (all items, winner) and returns the WhatsApp message it would send. */
export async function fillActaOnPhone(phone: Page): Promise<string> {
  await phone.locator('.acta-option').first().click();
  const items = phone.locator('.acta-items input');
  await expect(items).toHaveCount(22);
  for (let index = 0; index < 22; index++) await items.nth(index).fill(index % 2 ? '3' : '4');
  await phone.locator('.acta-options.big .acta-option').first().click();
  const href = await phone.getByRole('link', { name: 'Enviar por WhatsApp' }).getAttribute('href');
  return decodeURIComponent(href!.split('?text=')[1]);
}
