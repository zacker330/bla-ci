function calculateQuote({ unitPrice, quantity, discountPercent } = {}) {
  if (typeof unitPrice !== 'string' || !/^(0|[1-9]\d{0,5})(\.\d{1,2})?$/.test(unitPrice)) {
    throw new Error('单价须为 0 至 999999.99 元，最多两位小数');
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw new Error('数量须为 1 至 10000 的整数');
  }
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new Error('优惠比例须为 0 至 100 的整数');
  }

  const [yuan, fraction = ''] = unitPrice.split('.');
  const unitPriceCents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  const subtotalCents = unitPriceCents * quantity;
  const totalCents = Math.round(subtotalCents * (100 - discountPercent) / 100);
  return { subtotalCents, discountCents: subtotalCents - totalCents, totalCents };
}

module.exports = { calculateQuote };
