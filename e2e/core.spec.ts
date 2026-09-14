import { expect, test } from '@playwright/test';
test('öffentliche Demo ist ohne Login erreichbar', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Heute', level: 1 })).toBeVisible();
  await expect(page.getByText('Demo-Modus')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arbeitszeit eintragen' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arbeit starten' })).toBeVisible();
});

test('Baustelle anlegen, auswählen und Arbeit stempeln', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Heute', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Baustellen' }).click();
  await page.getByRole('button', { name: '+ Baustelle' }).click();
  await page.getByLabel('Name').fill('E2E Baustelle');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('E2E Baustelle')).toBeVisible();
  await page.getByRole('button', { name: 'Heute' }).click();
  await page.getByLabel('Baustelle').selectOption({ label: 'E2E Baustelle' });
  await page.getByRole('button', { name: 'Arbeit starten' }).click();
  await expect(page.getByText('Arbeitszeit läuft')).toBeVisible();
  await page.getByRole('button', { name: 'Pause starten' }).click();
  await expect(page.getByText('Pause läuft')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Pause läuft')).toBeVisible();
  await page.getByRole('button', { name: 'Pause beenden' }).click();
  await page.getByRole('button', { name: 'Arbeit beenden' }).click();
  await expect(page.getByText('Arbeitszeit beendet.')).toBeVisible();
});
test('funktioniert offline nach Erstladung', async ({ page, context, browserName }) => {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Heute', level: 1 })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Arbeit starten' }).click();
  if (browserName === 'chromium') await page.reload();
  await expect(page.getByRole('button', { name: 'Arbeit beenden' })).toBeVisible();
  await context.setOffline(false);
  if (browserName === 'webkit') {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Arbeit beenden' })).toBeVisible();
  }
});
test('Eintrag bearbeiten, löschen und wiederherstellen', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Arbeitszeit eintragen' }).first().click();
  await page.getByLabel('Datum').fill('2026-07-14');
  await page.getByLabel('Start').fill('08:00');
  await page.getByRole('textbox', { name: 'Ende' }).fill('16:30');
  await page.getByLabel('Tätigkeit').fill('Montage');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Zeiten' }).click();
  await page.getByText('Montage').click();
  await page.getByLabel('Notiz').fill('Fenster eingesetzt');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Fenster eingesetzt')).toBeVisible();
  await page.getByRole('button', { name: 'Eintrag löschen' }).first().click();
  await expect(page.getByText(/Rückgängig/)).toBeVisible();
  await page.getByText(/Rückgängig/).click();
  await expect(page.getByText('Fenster eingesetzt')).toBeVisible();
});
