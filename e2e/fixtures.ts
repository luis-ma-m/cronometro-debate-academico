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
    // The desk intentionally opens WhatsApp as a top-level navigation. Keep that
    // navigation local to the test runner (no real WhatsApp request), while still
    // blocking external data/subresource traffic.
    if (url.hostname === 'wa.me' && route.request().resourceType() === 'document' && route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp navigation stub</title>' });
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


/** Installs an isolated manager session for tests that exercise server-backed S8 links. */
export async function seedManagerSession(page: Page) {
  await page.addInitScript(() => localStorage.setItem('ledu-admin-session', JSON.stringify({ token: 'e2e-manager-token', expiresAt: Date.now() + 60 * 60 * 1000 })));
}

/** Mocks the short-link API while exercising the real UI, request contract and public resolver. */
export async function mockActaShortLinks(context: BrowserContext) {
  const links = new Map<string, { id: string; tournamentId: string; debateId: string; createdAt: number; expiresAt: number | null; revokedAt: null; snapshot: unknown }>();
  const idempotency = new Map<string, string>();
  let next = 0;
  await context.route('**/api**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('action') === 'health') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ok: true } }) }); return;
    }
    if (request.method() === 'GET' && url.searchParams.get('action') === 'resolveActaShortLink') {
      const item = links.get(url.searchParams.get('id') ?? '');
      if (!item) { await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Enlace no encontrado.' } }) }); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { snapshot: item.snapshot, expiresAt: item.expiresAt } }) }); return;
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { action?: string; payload?: Record<string, unknown> };
      const payload = body.payload ?? {};
      if (body.action === 'listActaShortLinks') {
        const tournamentId = String(payload.tournamentId ?? '');
        const result = [...links.values()].filter((item) => item.tournamentId === tournamentId).map((item) => ({
          id: item.id, tournamentId: item.tournamentId, debateId: item.debateId, createdAt: item.createdAt, expiresAt: item.expiresAt, revokedAt: item.revokedAt,
        }));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: result }) }); return;
      }
      if (body.action === 'createActaShortLink') {
        const key = String(payload.idempotencyKey ?? '');
        let id = idempotency.get(key);
        if (!id) {
          id = 'ABCDEFG' + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[next++ % 32];
          idempotency.set(key, id);
          links.set(id, { id, tournamentId: String(payload.tournamentId ?? ''), debateId: String(payload.debateId ?? ''), createdAt: Date.now(), expiresAt: null, revokedAt: null, snapshot: payload.snapshot });
        }
        const item = links.get(id)!;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: {
          id: item.id, tournamentId: item.tournamentId, debateId: item.debateId, createdAt: item.createdAt, expiresAt: item.expiresAt, revokedAt: item.revokedAt,
        } }) }); return;
      }
    }
    await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'E2E_UNEXPECTED_API', message: 'Unexpected API request: ' + request.method() + ' ' + url.href } }) });
  });
}
