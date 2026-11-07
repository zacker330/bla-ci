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
      await expect(page.getByRole('heading', { name: 'Quote calculator' })).toBeVisible();
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
  await expect(demo.page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(demo.page.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  await expect(demo.page).toHaveTitle('Quote calculator');
});

const languages = [
  {
    locale: 'en', title: 'Quote calculator', button: 'Calculate quote', price: /Unit price/, quantity: /Quantity/, discount: /Discount/,
    invalidPrice: 'Unit price must be between CNY 0 and 999999.99, with at most two decimal places.',
    invalidQuantity: 'Quantity must be an integer between 1 and 10000.',
    invalidDiscount: 'Discount must be an integer between 0 and 100.'
  },
  {
    locale: 'zh-CN', title: '报价计算器', button: '计算报价', price: /单价/, quantity: /数量/, discount: /优惠比例/,
    invalidPrice: '单价须为 0 至 999999.99 元，最多两位小数',
    invalidQuantity: '数量须为 1 至 10000 的整数',
    invalidDiscount: '优惠比例须为 0 至 100 的整数'
  }
];

for (const copy of languages) {
  test.describe(copy.locale, () => {
    test.beforeEach(async ({ demo }) => {
      await demo.page.locator('#language').selectOption(copy.locale);
      await expect(demo.page).toHaveTitle(copy.title);
      await expect(demo.page.locator('html')).toHaveAttribute('lang', copy.locale);
    });

    test('calculates a quote through the real preload and main-process IPC', async ({ demo }) => {
      await demo.page.getByRole('button', { name: copy.button }).click();
      await expect(demo.page.locator('#subtotal')).toHaveText('¥59.70');
      await expect(demo.page.locator('#discount')).toHaveText('¥5.97');
      await expect(demo.page.locator('#total')).toHaveText('¥53.73');
      await expect(demo.page.getByRole('alert')).toBeHidden();
      await demo.page.getByLabel(copy.price).fill('0.01');
      await demo.page.getByLabel(copy.quantity).fill('3');
      await demo.page.getByLabel(copy.discount).fill('50');
      await demo.page.getByRole('button', { name: copy.button }).click();
      await expect(demo.page.locator('#total')).toHaveText('¥0.02');
    });

    test('localizes validation errors and recovers while keeping IPC language-neutral', async ({ demo }) => {
      await demo.page.getByLabel(copy.price).fill('1.001');
      await demo.page.getByRole('button', { name: copy.button }).click();
      await expect(demo.page.getByRole('alert')).toHaveText(copy.invalidPrice);
      await demo.page.getByLabel(copy.price).fill('19.90');
      await demo.page.getByLabel(copy.quantity).fill('0');
      await demo.page.getByRole('button', { name: copy.button }).click();
      await expect(demo.page.getByRole('alert')).toHaveText(copy.invalidQuantity);
      await expect(demo.page.locator('#result')).toBeHidden();
      const invalid = await demo.page.evaluate(() => window.quote.calculate({ unitPrice: '1.00', quantity: 1.5, discountPercent: 0 }));
      expect(invalid).toEqual({ ok: false, error: 'INVALID_QUANTITY' });
      await demo.page.getByLabel(copy.quantity).fill('1');
      await demo.page.getByLabel(copy.discount).fill('101');
      await demo.page.getByRole('button', { name: copy.button }).click();
      await expect(demo.page.getByRole('alert')).toHaveText(copy.invalidDiscount);
      await demo.page.getByLabel(copy.discount).fill('100');
      await demo.page.getByRole('button', { name: copy.button }).click();
      await expect(demo.page.locator('#total')).toHaveText('¥0.00');
      await expect(demo.page.getByRole('alert')).toBeHidden();
    });
  });
}

test('preserves inputs and results and translates a visible error when switching languages', async ({ demo }) => {
  const { page } = demo;
  await page.getByLabel(/Unit price/).fill('12.50');
  await page.getByLabel(/Quantity/).fill('2');
  await page.getByLabel(/Discount/).fill('20');
  await page.getByRole('button', { name: 'Calculate quote' }).click();
  await expect(page.locator('#total')).toHaveText('¥20.00');
  await page.locator('#language').selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '报价计算器' })).toBeVisible();
  await expect(page.getByRole('region', { name: '计算结果' })).toBeVisible();
  await expect(page.getByLabel(/单价/)).toHaveValue('12.50');
  await expect(page.getByLabel(/数量/)).toHaveValue('2');
  await expect(page.getByLabel(/优惠比例/)).toHaveValue('20');
  await expect(page.locator('#total')).toHaveText('¥20.00');
  await page.getByLabel(/数量/).fill('0');
  await page.getByRole('button', { name: '计算报价' }).click();
  await expect(page.getByRole('alert')).toHaveText(languages[1].invalidQuantity);
  await page.locator('#language').selectOption('en');
  await expect(page.getByRole('alert')).toHaveText(languages[0].invalidQuantity);
  await expect(page.getByLabel(/Quantity/)).toHaveValue('0');
  await expect(page.getByRole('region', { name: 'Quote results' })).toBeHidden();
  await page.getByLabel(/Quantity/).fill('2');
  await page.getByRole('button', { name: 'Calculate quote' }).click();
  await expect(page.locator('#total')).toHaveText('¥20.00');
  await expect(page.getByRole('alert')).toBeHidden();
});
