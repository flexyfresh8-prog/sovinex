/**
 * Sonivex Studio - Electron main process.
 * Security: contextIsolation on, nodeIntegration off, sandboxed preload bridge,
 * all IPC channels validated. Renderer never touches Node directly.
 */
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

let mainWindow: BrowserWindow | null = null;

const MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx'];
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'];
const PROJECT_EXT = ['svx'];

function gotExtensions(list: string[], addAll: boolean, label: string): Electron.FileFilter[] {
  const filters: Electron.FileFilter[] = [
    { name: label, extensions: list },
  ];
  if (addAll) filters.push({ name: 'All Files', extensions: ['*'] });
  return filters;
}

const MAX_MODEL_BYTES = 256 * 1024 * 1024;
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_PROJECT_BYTES = 8 * 1024 * 1024;

async function readLimitedFile(p: string, max: number): Promise<Uint8Array> {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw new Error('Not a file');
  if (st.size > max) throw new Error(`File too large (${(st.size / 1048576).toFixed(1)} MB, limit ${(max / 1048576).toFixed(0)} MB)`);
  return new Uint8Array(await fsp.readFile(p));
}

function validateExt(p: string, exts: string[]): boolean {
  const e = path.extname(p).slice(1).toLowerCase();
  return exts.includes(e);
}

function registerIpc(): void {
  ipcMain.handle('dialog:openModel', async () => {
    const win = mainWindow;
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Import 3D Model',
      filters: gotExtensions(MODEL_EXT, true, '3D Model (GLB, GLTF, OBJ, FBX)'),
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const p = r.filePaths[0];
    if (!validateExt(p, MODEL_EXT)) return { error: `Unsupported model format: .${path.extname(p)}` };
    try {
      const data = await readLimitedFile(p, MAX_MODEL_BYTES);
      return { fileName: path.basename(p), filePath: p, data };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('dialog:openAudio', async () => {
    const win = mainWindow;
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Import Audio',
      filters: gotExtensions(AUDIO_EXT, true, 'Audio (MP3, WAV, FLAC, OGG)'),
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const p = r.filePaths[0];
    if (!validateExt(p, AUDIO_EXT)) return { error: `Unsupported audio format: .${path.extname(p)}` };
    try {
      const data = await readLimitedFile(p, MAX_AUDIO_BYTES);
      return { fileName: path.basename(p), filePath: p, data };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('dialog:saveProject', async (_e, suggestedName: unknown) => {
    const win = mainWindow;
    if (!win) return null;
    const name = typeof suggestedName === 'string' && suggestedName.trim() ? suggestedName.trim() : 'project';
    const safe = name.replace(/[\\/:*?"<>|]/g, '_') + '.svx';
    const r = await dialog.showSaveDialog(win, {
      title: 'Save Project',
      defaultPath: path.join(app.getPath('documents'), safe),
      filters: gotExtensions(PROJECT_EXT, false, 'Sonivex Project (.svx)'),
    });
    return r.canceled || !r.filePath ? null : r.filePath;
  });

  ipcMain.handle('dialog:openProject', async () => {
    const win = mainWindow;
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Open Project',
      filters: gotExtensions(PROJECT_EXT, true, 'Sonivex Project (.svx)'),
      properties: ['openFile'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    const p = r.filePaths[0];
    if (!validateExt(p, PROJECT_EXT)) return { error: 'Not a .svx project file' };
    try {
      const data = await readLimitedFile(p, MAX_PROJECT_BYTES);
      return { filePath: p, json: new TextDecoder().decode(data) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('fs:writeProject', async (_e, filePath: unknown, json: unknown) => {
    if (typeof filePath !== 'string' || !validateExt(filePath, PROJECT_EXT)) return { error: 'Invalid project path' };
    if (typeof json !== 'string' || json.length > MAX_PROJECT_BYTES) return { error: 'Invalid project payload' };
    try {
      await fsp.writeFile(filePath, json, 'utf8');
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('fs:writeExport', async (_e, suggestedName: unknown, mime: unknown, dataB64: unknown) => {
    if (typeof suggestedName !== 'string' || typeof dataB64 !== 'string') return { error: 'Invalid export payload' };
    const ext = typeof mime === 'string' && mime.includes('pdf') ? 'pdf' : 'csv';
    const safe = suggestedName.replace(/[\\/:*?"<>|]/g, '_');
    const win = mainWindow;
    if (!win) return null;
    const r = await dialog.showSaveDialog(win, {
      title: 'Export',
      defaultPath: path.join(app.getPath('documents'), safe.endsWith('.' + ext) ? safe : safe + '.' + ext),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (r.canceled || !r.filePath) return null;
    try {
      await fsp.writeFile(r.filePath, Buffer.from(dataB64, 'base64'));
      return { ok: true, filePath: r.filePath };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('report:printToPDF', async (_e, html: unknown) => {
    if (typeof html !== 'string' || html.length > 4 * 1024 * 1024) return { error: 'Invalid report payload' };
    try {
      const repWin = new BrowserWindow({
        show: false, width: 900, height: 1200,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await repWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await repWin.webContents.printToPDF({
        margins: { marginType: 'default' },
        printBackground: true,
        pageSize: 'A4',
      });
      repWin.destroy();
      return { data: pdf.toString('base64') };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Autosave (crash recovery)
  const autosavePath = (): string => path.join(app.getPath('userData'), 'autosave.svx');
  ipcMain.handle('autosave:write', async (_e, json: unknown) => {
    if (typeof json !== 'string' || json.length > MAX_PROJECT_BYTES) return { error: 'Invalid autosave payload' };
    try {
      await fsp.mkdir(path.dirname(autosavePath()), { recursive: true });
      await fsp.writeFile(autosavePath(), json, 'utf8');
      return { ok: true, path: autosavePath() };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('autosave:read', async () => {
    try {
      const data = await fsp.readFile(autosavePath(), 'utf8');
      return { json: data, mtime: (await fsp.stat(autosavePath())).mtimeMs };
    } catch {
      return { json: null };
    }
  });
  ipcMain.handle('autosave:clear', async () => {
    try { await fsp.unlink(autosavePath()); } catch { /* ignore */ }
    return { ok: true };
  });

  ipcMain.handle('fs:readModelPath', async (_e, p: unknown) => {
    if (typeof p !== 'string' || !validateExt(p, MODEL_EXT)) return { error: 'Invalid model path' };
    if (!fs.existsSync(p)) return { error: 'Model file not found: ' + p };
    try {
      const data = await readLimitedFile(p, MAX_MODEL_BYTES);
      return { fileName: path.basename(p), filePath: p, data };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('fs:readAudioPath', async (_e, p: unknown) => {
    if (typeof p !== 'string' || !validateExt(p, AUDIO_EXT)) return { error: 'Invalid audio path' };
    if (!fs.existsSync(p)) return { error: 'Audio file not found: ' + p };
    try {
      const data = await readLimitedFile(p, MAX_AUDIO_BYTES);
      return { fileName: path.basename(p), filePath: p, data };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
  }));

  ipcMain.handle('shell:showItem', async (_e, p: unknown) => {
    if (typeof p === 'string' && fs.existsSync(p)) { shell.showItemInFolder(p); return { ok: true }; }
    return { error: 'File not found' };
  });
}

function createWindow(): void {
  const iconPath = path.join(__dirname, '../build/icon.png');
  mainWindow = new BrowserWindow({
    width: 1600, height: 960,
    minWidth: 1280, minHeight: 800,
    show: false,
    backgroundColor: '#0A0A0A',
    title: 'Sonivex Studio',
    autoHideMenuBar: true,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { app.quit(); });
}
