// @ts-check
/**
 * E2E alur utama aplikasi RequestLagu:
 *  1. gerbang tamu (login salah/benar)
 *  2. tamu: kirim request → muncul di antrean → vote
 *  3. DJ: login → putar lagu → status LIVE ON AIR + toast
 *  4. DJ: tolak request pending → hilang dari antrean
 *  5. gerbang DJ: user biasa ditolak
 *
 * Semua data pakai judul unik (timestamp) supaya toleran terhadap state
 * lama bila webServer reuse server yang sedang berjalan.
 */
import { test, expect } from '@playwright/test';

const rand = Date.now().toString(36) + Math.floor(Math.random() * 10000).toString(36);
const YT = 'dQw4w9WgXcQ';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Toast memakai div role="status" + data-tone (bukan live region player). */
const toast = (page) => page.locator('div[role="status"][data-tone]');

async function loginTamu(page) {
  await page.goto('/');
  await page.getByLabel('Username').fill('panitia1');
  await page.getByLabel('Kata Sandi').fill('user-pass-123');
  await page.getByRole('button', { name: 'Masuk & Request Lagu' }).click();
  await expect(page.locator('#antrean')).toBeVisible();
}

async function loginDj(page) {
  await page.goto('/dj');
  await page.getByLabel('ID Operator').fill('admin');
  await page.getByLabel('Security Token').fill('admin-pass-123');
  await page.getByRole('button', { name: 'Masuk ke Deck DJ' }).click();
  await expect(page.getByRole('heading', { name: 'Antrean', exact: true })).toBeVisible();
}

async function tokenApi(request, username, password) {
  const res = await request.post('/api/login', { data: { username, password } });
  expect(res.status()).toBe(200);
  const data = await res.json();
  return data.token;
}

async function setEvent(request, adminToken, patch) {
  const res = await request.patch('/api/event', {
    headers: { 'x-dj-token': adminToken },
    data: patch,
  });
  expect(res.status()).toBe(200);
}

async function buatRequest(request, token, title) {
  const res = await request.post('/api/request', {
    headers: { 'x-dj-token': token },
    data: { title, artist: 'Artis E2E', yt: YT, message: 'dari e2e' },
  });
  expect(res.ok()).toBe(true); // 201 Created
}

/** Adzan menahan pemutaran (toast "Sedang adzan…") — nonaktifkan dulu supaya
 *  suite deterministik walau dijalankan pada jam adzan; dikembalikan setelahnya. */
test.beforeAll(async ({ request }) => {
  const admin = await tokenApi(request, 'admin', 'admin-pass-123');
  const res = await request.post('/api/adzan/pengaturan', {
    headers: { 'x-dj-token': admin },
    data: { enabled: false },
  });
  expect(res.status()).toBe(200);
});

test.afterAll(async ({ request }) => {
  const admin = await tokenApi(request, 'admin', 'admin-pass-123');
  await request.post('/api/adzan/pengaturan', {
    headers: { 'x-dj-token': admin },
    data: { enabled: true },
  });
});

test('gerbang tamu: login salah ditolak, login benar masuk', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Masuk dulu' })).toBeVisible();

  await page.getByLabel('Username').fill('panitia1');
  await page.getByLabel('Kata Sandi').fill('salah-salah');
  await page.getByRole('button', { name: 'Masuk & Request Lagu' }).click();
  await expect(page.getByRole('alert')).toHaveText(/Username atau password salah/);
  await expect(page.getByRole('heading', { name: 'Masuk dulu' })).toBeVisible();

  await page.getByLabel('Kata Sandi').fill('user-pass-123');
  await page.getByRole('button', { name: 'Masuk & Request Lagu' }).click();
  await expect(page.locator('#antrean')).toBeVisible();
});

test('tamu: kirim request → masuk antrean → vote', async ({ page, request }) => {
  const admin = await tokenApi(request, 'admin', 'admin-pass-123');
  await setEvent(request, admin, { open: true, autoApprove: true });

  const judul = `Lagu E2E ${rand}`;
  await loginTamu(page);

  await page.getByLabel('Judul Lagu').fill(judul);
  await page.getByLabel('Artis').fill('Artis E2E');
  await page.getByLabel('Link YouTube').fill(`https://youtu.be/${YT}`);
  await page.getByLabel('Pesan Singkat').fill('pesan dari e2e');
  await page.getByRole('button', { name: 'Kirim Request' }).click();

  await expect(page.locator('#antrean').getByText(judul, { exact: false })).toBeVisible();

  const voteBtn = page.getByRole('button', { name: `Vote untuk ${judul}` });
  await expect(voteBtn).toBeVisible();
  await voteBtn.click();
  await expect(
    page.getByRole('button', { name: `Batalkan vote untuk ${judul}` }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('DJ: putar lagu dari antrean → LIVE ON AIR + toast', async ({ page, request }) => {
  const admin = await tokenApi(request, 'admin', 'admin-pass-123');
  await setEvent(request, admin, { open: true, autoApprove: true });
  const tamu = await tokenApi(request, 'panitia1', 'user-pass-123');

  const judul = `Putar E2E ${rand}`;
  await buatRequest(request, tamu, judul);

  await loginDj(page);
  const row = page.locator('article', { hasText: judul });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Putar', exact: true }).click();

  await expect(toast(page)).toHaveText(new RegExp(`Memutar.*${esc(judul)}`));
  await expect(page.getByText('LIVE ON AIR')).toBeVisible();
  await expect(page.getByText(judul, { exact: false }).first()).toBeVisible();
});

test('DJ: tolak request pending → hilang dari antrean', async ({ page, request }) => {
  const admin = await tokenApi(request, 'admin', 'admin-pass-123');
  await setEvent(request, admin, { open: true, autoApprove: false });
  try {
    const tamu = await tokenApi(request, 'panitia1', 'user-pass-123');
    const judul = `Tolak E2E ${rand}`;
    await buatRequest(request, tamu, judul);

    await loginDj(page);
    const row = page.locator('article', { hasText: judul });
    await expect(row).toBeVisible();
    await page.getByRole('button', { name: `Tolak ${judul}` }).click();
    await expect(row).toHaveCount(0);
    await expect(toast(page)).toHaveText(/Request ditolak/);
  } finally {
    await setEvent(request, admin, { autoApprove: true });
  }
});

test('gerbang DJ: user biasa ditolak dengan notice', async ({ page }) => {
  await page.goto('/dj');
  await expect(page.getByRole('heading', { name: 'Skarisa Bergoyang' })).toBeVisible();

  await page.getByLabel('ID Operator').fill('panitia1');
  await page.getByLabel('Security Token').fill('user-pass-123');
  await page.getByRole('button', { name: 'Masuk ke Deck DJ' }).click();
  await expect(page.getByRole('alert')).toHaveText(/hanya untuk admin/);
  await expect(page.getByRole('heading', { name: 'Skarisa Bergoyang' })).toBeVisible();
});
