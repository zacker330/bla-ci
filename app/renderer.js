const messages = {
  en: {
    title: 'Quote calculator',
    intro: 'Enter a unit price and quantity to calculate your discounted quote.',
    offline: 'Offline',
    language: 'Language',
    unitPrice: 'Unit price',
    currencyUnit: 'CNY',
    quantity: 'Quantity',
    items: 'items',
    discountPercent: 'Discount',
    hint: '10% off means you pay 90%.',
    calculate: 'Calculate quote',
    results: 'Quote results',
    subtotal: 'Subtotal',
    discountAmount: 'Discount amount',
    total: 'Total due',
    rounding: 'Chinese yuan · Rounded to the nearest cent',
    localOnly: 'All calculations stay on this device',
    errors: {
      INVALID_PRICE: 'Unit price must be between CNY 0 and 999999.99, with at most two decimal places.',
      INVALID_QUANTITY: 'Quantity must be an integer between 1 and 10000.',
      INVALID_DISCOUNT: 'Discount must be an integer between 0 and 100.',
      INVALID_SOURCE: 'This request is not allowed.',
      CALCULATION_FAILED: 'Unable to calculate this quote. Please try again.'
    }
  },
  'zh-CN': {
    title: '报价计算器',
    intro: '填入单价与数量，算出优惠后的报价。',
    offline: '离线计算',
    language: '语言',
    unitPrice: '单价',
    currencyUnit: '元',
    quantity: '数量',
    items: '件',
    discountPercent: '优惠比例',
    hint: '例如：优惠 10%，即按九折计算。',
    calculate: '计算报价',
    results: '计算结果',
    subtotal: '商品金额',
    discountAmount: '优惠金额',
    total: '应付金额',
    rounding: '人民币 · 四舍五入至分',
    localOnly: '所有计算均在本机完成',
    errors: {
      INVALID_PRICE: '单价须为 0 至 999999.99 元，最多两位小数',
      INVALID_QUANTITY: '数量须为 1 至 10000 的整数',
      INVALID_DISCOUNT: '优惠比例须为 0 至 100 的整数',
      INVALID_SOURCE: '请求来源无效',
      CALCULATION_FAILED: '暂时无法计算报价，请重试'
    }
  }
};

const form = document.querySelector('form');
const languageSelect = document.querySelector('#language');
const errorMessage = document.querySelector('[role="alert"]');
const result = document.querySelector('#result');
let language = 'en';
let lastQuote = null;
let errorCode = null;

function renderQuote() {
  result.hidden = !lastQuote;
  if (!lastQuote) return;
  const money = new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    style: 'currency', currency: 'CNY', currencyDisplay: 'narrowSymbol'
  });
  document.querySelector('#subtotal').textContent = money.format(lastQuote.subtotalCents / 100);
  document.querySelector('#discount').textContent = money.format(lastQuote.discountCents / 100);
  document.querySelector('#total').textContent = money.format(lastQuote.totalCents / 100);
}

function renderError() {
  errorMessage.hidden = !errorCode;
  errorMessage.textContent = errorCode ? messages[language].errors[errorCode] ?? messages[language].errors.CALCULATION_FAILED : '';
}

function setLanguage(value) {
  language = Object.hasOwn(messages, value) ? value : 'en';
  languageSelect.value = language;
  document.documentElement.lang = language;
  document.title = messages[language].title;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = messages[language][element.dataset.i18n];
  }
  result.setAttribute('aria-label', messages[language].results);
  renderQuote();
  renderError();
}

languageSelect.addEventListener('change', () => setLanguage(languageSelect.value));
setLanguage('en');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorCode = null;
  lastQuote = null;
  renderQuote();
  renderError();
  const data = new FormData(form);
  try {
    const response = await window.quote.calculate({
      unitPrice: data.get('unitPrice').trim(),
      quantity: data.get('quantity').trim() === '' ? NaN : Number(data.get('quantity')),
      discountPercent: data.get('discountPercent').trim() === '' ? NaN : Number(data.get('discountPercent'))
    });
    if (response.ok) lastQuote = response.quote;
    else errorCode = response.error || 'CALCULATION_FAILED';
  } catch {
    errorCode = 'CALCULATION_FAILED';
  }
  renderQuote();
  renderError();
});
