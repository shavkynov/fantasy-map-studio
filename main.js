const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#1c1916',
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    title: 'Fantasy Map Studio v' + app.getVersion(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

function openThreeBlockPrototype() {
  const win = new BrowserWindow({
    width: 1280, height: 900, minWidth: 900, minHeight: 650,
    title: 'Fantasy Map Studio — три блока (эксперимент)',
    backgroundColor: '#122633',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'three-block-prototype.html'));
}

ipcMain.handle('save-png', async (event, arrayBuffer, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || 'map.png',
    filters: [{ name: 'PNG', extensions: ['png'] }]
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
  return filePath;
});

ipcMain.handle('save-world', async (event, text, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: suggestedName || 'world.fmworld', filters: [{ name: 'Fantasy Map Studio', extensions: ['fmworld'] }] });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
});

ipcMain.handle('save-json', async (event, text, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: suggestedName || 'world.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
});

ipcMain.handle('open-world', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Fantasy Map Studio', extensions: ['fmworld', 'json'] }] });
  if (canceled || !filePaths.length) return null;
  return fs.readFileSync(filePaths[0], 'utf8');
});

app.setName('Fantasy Map Studio');
app.setAboutPanelOptions({ applicationName: 'Fantasy Map Studio', applicationVersion: app.getVersion(), copyright: '© Александр Шавкунов', iconPath: path.join(__dirname, 'build', 'icon.png') });

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) { try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch (e) {} }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Файл', submenu: [{ role: 'close' }] },
    { role: 'editMenu' }, { role: 'viewMenu' },
    { label: 'Прототип', submenu: [{ label: 'Три блока (эксперимент)', accelerator: 'CmdOrCtrl+Shift+3', click: openThreeBlockPrototype }] },
    { role: 'windowMenu' }
  ]));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
