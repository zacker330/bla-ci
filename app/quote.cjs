class QuoteValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'QuoteValidationError';
    this.code = code;
  }
}

function calculateQuote({ unitPrice, quantity, discountPercent } = {}) {
  if (typeof unitPrice !== 'string' || !/^(0|[1-9]\d{0,5})(\.\d{1,2})?$/.test(unitPrice)) {
    throw new QuoteValidationError('INVALID_PRICE', 'Unit price must be between CNY 0 and 999999.99, with at most two decimal places.');
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw new QuoteValidationError('INVALID_QUANTITY', 'Quantity must be an integer between 1 and 10000.');
  }
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new QuoteValidationError('INVALID_DISCOUNT', 'Discount must be an integer between 0 and 100.');
  }

  const [yuan, fraction = ''] = unitPrice.split('.');
  const unitPriceCents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  const subtotalCents = unitPriceCents * quantity;
  const totalCents = Math.round(subtotalCents * (100 - discountPercent) / 100);
  return { subtotalCents, discountCents: subtotalCents - totalCents, totalCents };
}

module.exports = { calculateQuote, QuoteValidationError };
