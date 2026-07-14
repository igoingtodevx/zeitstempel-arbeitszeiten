import { expect, test } from '@playwright/test';
test('Baustelle anlegen, auswählen und Arbeit stempeln', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Arbeitszeit' })).toBeVisible();
  await page.getByRole('button', { name: 'Baustellen' }).click();
  await page.getByRole('button', { name: '+ Baustelle' }).click();
  await page.getByLabel('Name').fill('Neubau Müller');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Neubau Müller')).toBeVisible();
  await page.getByRole('button', { name: 'Stempeln' }).click();
  await page.getByLabel('Baustelle').selectOption({ label: 'Neubau Müller' });
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
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Arbeitszeit' })).toBeVisible();
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
  await page.goto('/');
  await page.getByRole('button', { name: '+ Eintrag' }).click();
  await page.getByLabel('Start').fill('2026-07-14T08:00');
  await page.getByLabel('Ende').fill('2026-07-14T16:30');
  await page.getByLabel('Tätigkeit').fill('Montage');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('button', { name: 'Zeiten' }).click();
  await page.getByText('Montage').click();
  await page.getByLabel('Notiz').fill('Fenster eingesetzt');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Fenster eingesetzt')).toBeVisible();
  await page.getByText('Löschen').click();
  await expect(page.getByText(/Rückgängig/)).toBeVisible();
  await page.getByText(/Rückgängig/).click();
  await expect(page.getByText('Fenster eingesetzt')).toBeVisible();
});
