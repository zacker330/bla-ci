import { test as base, expect, _electron as electron } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const build = JSON.parse(readFileSync(path.join(root, 'dist/build.json'), 'utf8'));

const test = base.extend({
  demo: async ({}, use, testInfo) => {
    const variant = build.variants[testInfo.project.name];
    const userData = mkdtempSync(path.join(tmpdir(), 'bla-ci-e2e-'));
    const errors = [];
    const logs = [];
    let application;
    let page;
    let tracing = false;
    try {
      application = await electron.launch({
        executablePath: path.join(root, variant.executable),
        cwd: userData,
        env: { ...process.env, BLA_CI_USER_DATA_DIR: userData },
        timeout: 30000
      });
      application.process().stderr?.on('data', (chunk) => logs.push(chunk.toString()));
      await application.context().tracing.start({ screenshots: true, snapshots: true });
      tracing = true;
      page = await application.firstWindow();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await expect(page.getByRole('heading', { name: '算一笔明白账。' })).toBeVisible();
      await use({ application, page, variant });
      expect(errors, 'The renderer and preload must run without errors').toEqual([]);
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus || errors.length > 0;
      try {
        if (application && failed) {
          const logPath = testInfo.outputPath('electron.log');
          writeFileSync(logPath, [...errors, ...logs].join('\n'));
          await testInfo.attach('electron-log', { path: logPath, contentType: 'text/plain' });
          if (page && !page.isClosed()) {
            const screenshot = testInfo.outputPath('failure.png');
            await page.screenshot({ path: screenshot });
            await testInfo.attach('screenshot', { path: screenshot, contentType: 'image/png' });
          }
        }
        const trace = failed ? testInfo.outputPath('trace.zip') : undefined;
        if (tracing) {
          await application.context().tracing.stop(trace ? { path: trace } : {});
          if (trace) await testInfo.attach('trace', { path: trace, contentType: 'application/zip' });
        }
      } finally {
        try {
          await application?.close();
        } finally {
          rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
      }
    }
  }
});

test('loads the intended ASAR as a packaged, isolated desktop app', async ({ demo }) => {
  const actual = await demo.application.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  }));
  expect(actual.packaged).toBe(true);
  expect(path.normalize(actual.appPath)).toBe(path.normalize(path.join(root, demo.variant.asar)));
  expect(createHash('sha256').update(readFileSync(actual.appPath)).digest('hex')).toBe(demo.variant.sha256);
  expect(actual.preferences.contextIsolation).toBe(true);
  expect(actual.preferences.nodeIntegration).toBe(false);
  expect(actual.preferences.sandbox).toBe(true);
  expect(await demo.page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, calculate: typeof window.quote?.calculate })))
    .toEqual({ require: 'undefined', process: 'undefined', calculate: 'function' });
});

test('calculates a quote through the real preload and main-process IPC', async ({ demo }) => {
  await demo.page.getByRole('button', { name: '计算报价' }).click();
  await expect(demo.page.locator('#subtotal')).toHaveText('¥59.70');
  await expect(demo.page.locator('#discount')).toHaveText('¥5.97');
  await expect(demo.page.locator('#total')).toHaveText('¥53.73');
  await expect(demo.page.getByRole('alert')).toBeHidden();
  await demo.page.getByLabel(/单价/).fill('0.01');
  await demo.page.getByLabel(/数量/).fill('3');
  await demo.page.getByLabel(/优惠比例/).fill('50');
  await demo.page.getByRole('button', { name: '计算报价' }).click();
  await expect(demo.page.locator('#total')).toHaveText('¥0.02');
});

test('rejects invalid inputs at the IPC boundary and recovers in the UI', async ({ demo }) => {
  await demo.page.getByLabel(/数量/).fill('0');
  await demo.page.getByRole('button', { name: '计算报价' }).click();
  await expect(demo.page.getByRole('alert')).toHaveText('数量须为 1 至 10000 的整数');
  await expect(demo.page.locator('#result')).toBeHidden();
  const invalid = await demo.page.evaluate(() => window.quote.calculate({ unitPrice: '1.00', quantity: 1.5, discountPercent: 0 }));
  expect(invalid).toEqual({ ok: false, error: '数量须为 1 至 10000 的整数' });
  await demo.page.getByLabel(/数量/).fill('1');
  await demo.page.getByLabel(/优惠比例/).fill('100');
  await demo.page.getByRole('button', { name: '计算报价' }).click();
  await expect(demo.page.locator('#total')).toHaveText('¥0.00');
  await expect(demo.page.getByRole('alert')).toBeHidden();
});
