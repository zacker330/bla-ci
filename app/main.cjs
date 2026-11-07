const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { calculateQuote } = require('./quote.cjs');

const pagePath = path.join(__dirname, 'index.html');
const pageURL = pathToFileURL(pagePath).href;

if (process.env.BLA_CI_USER_DATA_DIR) {
  app.setPath('userData', process.env.BLA_CI_USER_DATA_DIR);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 640,
    minHeight: 620,
    backgroundColor: '#f4f2ed',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadFile(pagePath);
}

app.whenReady().then(() => {
  ipcMain.handle('quote:calculate', (event, input) => {
    if (event.senderFrame?.url !== pageURL) {
      return { ok: false, error: '请求来源无效' };
    }
    try {
      return { ok: true, quote: calculateQuote(input) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
