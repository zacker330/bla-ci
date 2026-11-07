const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuote } = require('../app/quote.cjs');

test('calculates a discounted quote in cents', () => {
  assert.deepEqual(calculateQuote({ unitPrice: '19.90', quantity: 3, discountPercent: 10 }), {
    subtotalCents: 5970, discountCents: 597, totalCents: 5373
  });
});

test('rounds the final payable amount, including a half cent', () => {
  assert.equal(calculateQuote({ unitPrice: '0.01', quantity: 1, discountPercent: 50 }).totalCents, 1);
  assert.equal(calculateQuote({ unitPrice: '0.01', quantity: 3, discountPercent: 50 }).totalCents, 2);
});

test('supports zero price, no discount and a full discount', () => {
  assert.equal(calculateQuote({ unitPrice: '0', quantity: 1, discountPercent: 0 }).totalCents, 0);
  assert.equal(calculateQuote({ unitPrice: '1.2', quantity: 2, discountPercent: 0 }).totalCents, 240);
  assert.equal(calculateQuote({ unitPrice: '19.90', quantity: 3, discountPercent: 100 }).totalCents, 0);
});

test('keeps the maximum supported quote within exact integer arithmetic', () => {
  assert.equal(calculateQuote({ unitPrice: '999999.99', quantity: 10000, discountPercent: 0 }).totalCents, 999999990000);
});

test('rejects invalid prices without silently rounding the input', () => {
  for (const unitPrice of ['', '-1', '1.001', '1e2', 'Infinity', '1000000', '01', 19.9, null]) {
    assert.throws(() => calculateQuote({ unitPrice, quantity: 1, discountPercent: 0 }), /单价/);
  }
});

test('validates quantity in the main-process calculation boundary', () => {
  for (const quantity of [0, -1, 1.5, 10001, NaN, Infinity, '3', null]) {
    assert.throws(() => calculateQuote({ unitPrice: '1.00', quantity, discountPercent: 0 }), /数量/);
  }
});

test('validates the discount and rejects a missing request', () => {
  for (const discountPercent of [-1, 101, 0.5, NaN, '10', null]) {
    assert.throws(() => calculateQuote({ unitPrice: '1.00', quantity: 1, discountPercent }), /优惠/);
  }
  assert.throws(() => calculateQuote(), /单价/);
});
