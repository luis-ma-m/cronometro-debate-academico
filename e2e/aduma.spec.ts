import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './fixtures';

const PUBLIC_AND_PRIVATE = (name: string) => [
  'privado/copia-torneo.json', 'privado/registro.csv', 'privado/registro.json', 'publico/' + name + '.csv', 'publico/' + name + '.pdf', 'publico/' + name + '.txt',
];

async function openAdumaRehearsal(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/tabulacion');
  await page.getByRole('button', { name: /Crear ensayo ADUMA/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Rondas' })).toBeVisible();
}

/** Confirms the open draft (accepting its warnings) and returns the files of the ZIP it downloads. */
async function confirmDraft(page: Page): Promise<Record<string, Uint8Array>> {
  const acknowledge = page.getByLabel(/Confirmo bajo mi responsabilidad/);
  if (await acknowledge.isVisible()) await acknowledge.check();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Confirmar ronda' }).click();
  const file = await (await download).path();
  return unzipSync(new Uint8Array(await readFile(file)));
}

async function simulate(page: Page) {
  await page.getByRole('button', { name: 'Simular resultados' }).click();
  await expect(page.getByText(/Resultados simulados/)).toBeVisible();
}

async function nav(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name }).click();
}

test('ADUMA de principio a fin: borrador editable, ZIP por ronda, equipo caído, cuadro y registro', async ({ page }) => {
  await openAdumaRehearsal(page);

  // Round 1: public seed, one manual change, confirmation with automatic ZIP.
  await page.getByLabel('Semilla del sorteo (opcional)').fill('ADUMA2026');
  await page.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  await expect(page.getByRole('heading', { name: 'Ronda 1 · borrador' })).toBeVisible();
  const moving = await page.getByLabel(/^Equipo 1 de /).nth(1).inputValue();
  await page.getByLabel(/^Equipo 1 de /).first().selectOption(moving);
  await expect(page.getByRole('button', { name: 'Deshacer' })).toBeEnabled();
  await expect(page.getByText(/Cambios respecto al sorteo \(2\)/)).toBeVisible();
  const round1 = await confirmDraft(page);
  expect(Object.keys(round1).sort()).toEqual(PUBLIC_AND_PRIVATE('ronda-1'));
  const txt = strFromU8(round1['publico/ronda-1.txt']);
  expect(txt).toContain('Ronda 1 · emparejamientos');
  expect(txt).toMatch(/registro n\.º \d+ · huella [0-9a-f]{14}/);
  expect(new TextDecoder().decode(round1['publico/ronda-1.pdf'].slice(0, 5))).toBe('%PDF-');
  expect(JSON.parse(strFromU8(round1['privado/copia-torneo.json'])).tournament.rounds).toHaveLength(1);
  await expect(page.locator('.tab-round-screen')).toContainText('frente a');

  // One acta typed by hand in quick mode; the rest simulated.
  await nav(page, 'Actas');
  await page.locator('.tab-ballot-list li button').first().click();
  const teams = (await page.locator('.tab-ballot-editor h3').innerText()).split(' · ')[1].split(' – ');
  await page.getByLabel(/Modo rápido/).check();
  await page.getByLabel('Total de ítems de ' + teams[0]).fill('41');
  await page.getByLabel('Total de ítems de ' + teams[1]).fill('36');
  await page.getByRole('radio', { name: teams[0], exact: true }).check();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Acta guardada: gana ' + teams[0] + '.')).toBeVisible();
  await expect(page.locator('.tab-ballot-list li').first()).toContainText('Completa');
  await nav(page, 'Rondas');
  await simulate(page);

  // A team falls from round 2: its debates are not held and get no room or judges.
  await nav(page, 'Participantes');
  const fallenName = await page.locator('.tab-entity').first().getByLabel('Nombre del equipo').inputValue();
  await page.locator('.tab-entity').first().getByLabel('Equipo caído').check();
  await expect(page.locator('.tab-entity').first().getByLabel(/Caído desde la ronda/)).toHaveValue('2');
  await nav(page, 'Rondas');

  for (const number of [2, 3, 4]) {
    await page.getByRole('button', { name: 'Nueva ronda (Ronda ' + number + ')' }).click();
    await expect(page.getByRole('heading', { name: 'Ronda ' + number + ' · borrador' })).toBeVisible();
    await expect(page.locator('.tab-draft')).toContainText('No se disputa');
    const files = await confirmDraft(page);
    expect(strFromU8(files['publico/ronda-' + number + '.txt'])).toContain('«' + fallenName + '» está caído');
    await simulate(page);
  }

  // Ties at the cut are settled by the organisers in the standings.
  await nav(page, 'Clasificación');
  for (let guard = 0; guard < 20 && await page.getByRole('button', { name: 'Fijar este orden' }).first().isVisible(); guard++) {
    await page.getByRole('button', { name: 'Fijar este orden' }).first().click();
  }
  await expect(page.locator('.tab-standings').first()).toContainText('caído desde la ronda 2');
  await nav(page, 'Rondas');

  await page.getByRole('button', { name: 'Generar eliminatorias' }).click();
  await expect(page.getByRole('heading', { name: 'Cuartos de final · borrador' })).toBeVisible();
  expect(Object.keys(await confirmDraft(page)).sort()).toEqual(PUBLIC_AND_PRIVATE('cuartos-de-final'));
  await simulate(page);
  for (const name of ['Semifinales', 'Final']) {
    await page.getByRole('button', { name: 'Nueva eliminatoria' }).click();
    await expect(page.getByRole('heading', { name: name + ' · borrador' })).toBeVisible();
    await confirmDraft(page);
    await simulate(page);
  }
  await expect(page.getByText(/Campeón del torneo/).first()).toBeVisible();

  // The whole day is in the log, and its hash chain verifies.
  await nav(page, 'Registro');
  await page.getByRole('button', { name: 'Verificar registro' }).click();
  await expect(page.getByText(/El registro verifica/)).toBeVisible();
  await expect(page.locator('.tab-log')).toContainText('confirmada');
  await expect(page.locator('.tab-log')).toContainText('marcado como equipo caído desde la ronda 2');
});

test('un borrador pendiente sobrevive a una recarga', async ({ page }) => {
  await openAdumaRehearsal(page);
  await page.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  await expect(page.getByRole('heading', { name: 'Ronda 1 · borrador' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ronda 1 · borrador' })).toBeVisible();
});

test('una segunda pestaña queda en solo lectura hasta que toma el control', async ({ context }) => {
  const first = await context.newPage();
  await openAdumaRehearsal(first);
  const second = await context.newPage();
  second.on('dialog', (dialog) => void dialog.accept());
  await second.goto('/tabulacion#rondas');
  await expect(second.getByText(/aquí solo se puede consultar/)).toBeVisible();
  await second.getByRole('button', { name: 'Tomar el control' }).click();
  await expect(second.getByText(/aquí solo se puede consultar/)).toBeHidden();
  await expect(first.getByText(/aquí solo se puede consultar/)).toBeVisible();
  await second.getByRole('button', { name: 'Nueva ronda (Ronda 1)' }).click();
  await expect(second.getByRole('heading', { name: 'Ronda 1 · borrador' })).toBeVisible();
});

test('datos dañados en el navegador no bloquean la aplicación', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/tabulacion');
  await page.evaluate(() => {
    localStorage.setItem('ledu-tabulacion-v1:roto', '{esto no es json');
    localStorage.setItem('ledu-tabulacion-index-v1', JSON.stringify({ activeId: 'roto', tournaments: [{ id: 'roto', name: 'Roto', updatedAt: 1 }] }));
    localStorage.setItem('ledu-tabulacion-log-v1:roto:0', '[dañado');
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tabulación del torneo' })).toBeVisible();
  await page.getByRole('button', { name: 'Crear Torneo ADUMA' }).click();
  await expect(page.getByRole('heading', { name: 'Participantes' })).toBeVisible();
  await nav(page, 'Registro');
  await expect(page.locator('.tab-log')).toContainText('Torneo creado');
});
