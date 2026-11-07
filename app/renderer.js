const form = document.querySelector('form');
const errorMessage = document.querySelector('[role="alert"]');
const result = document.querySelector('#result');
const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  result.hidden = true;
  const data = new FormData(form);
  try {
    const response = await window.quote.calculate({
      unitPrice: data.get('unitPrice').trim(),
      quantity: data.get('quantity').trim() === '' ? NaN : Number(data.get('quantity')),
      discountPercent: data.get('discountPercent').trim() === '' ? NaN : Number(data.get('discountPercent'))
    });
    if (!response.ok) throw new Error(response.error);
    document.querySelector('#subtotal').textContent = money.format(response.quote.subtotalCents / 100);
    document.querySelector('#discount').textContent = money.format(response.quote.discountCents / 100);
    document.querySelector('#total').textContent = money.format(response.quote.totalCents / 100);
    result.hidden = false;
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
  }
});
