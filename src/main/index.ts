import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { MainEvent, ProviderId } from '../shared/types';
import { detectCli } from './cli';
import { runtimePath } from './runtime-path';
import { previewConversationFile, resolveConversationFile } from './file-links';
import { ClaudeAdapter } from './providers/claude';
import { CodexAdapter } from './providers/codex';
import { AiloService } from './service';
import { Store } from './store';
import { SecretVault } from './secrets';
import { CompletionNotifications, setupNotificationIdentity } from './notifications';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.PATH = runtimePath();

if (process.env.AILO_DATA_DIR) app.setPath('userData', path.resolve(process.env.AILO_DATA_DIR));
if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | undefined;
let service: AiloService;
let notifications: CompletionNotifications | undefined;
const icon = path.join(here, '../renderer/icon.png');

function send(e: MainEvent): void {
  win?.webContents.send('ailo:event', e);
  notifications?.handle(e);
}

function safeOpen(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.toString());
  } catch {
    /* ignore invalid urls */
  }
}

function createWindow(): void {
  const theme = service.state.settings.theme;
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 520,
    title: 'Ailo',
    icon,
    backgroundColor: dark ? '#17181b' : '#f7f7f5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    safeOpen(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) {
      e.preventDefault();
      safeOpen(url);
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(here, '../renderer/index.html'));
  win.on('closed', () => (win = undefined));
  win.on('blur', () => service.setViewedConversation(null));
  win.on('minimize', () => service.setViewedConversation(null));
  win.on('focus', () => win?.flashFrame(false));
}

function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

app.whenReady().then(() => {
  const store = new Store(path.join(app.getPath('userData'), 'data'));
  service = new AiloService(store, { claude: new ClaudeAdapter(), codex: new CodexAdapter() }, send, safeOpen, new SecretVault(store.root, async (text) => {
    if (!await safeStorage.isAsyncEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('OS-protected credential storage is unavailable.');
    return safeStorage.encryptStringAsync(text);
  }, async (data) => (await safeStorage.decryptStringAsync(data)).result));
  store.recoverInterrupted();
  setupNotificationIdentity(path.join(here, '../renderer/icon.ico'));
  notifications = new CompletionNotifications(service, () => win, icon);

  handle('getState', () => service.state);
  handle('listAccountMcp', id => service.listAccountMcp(id));
  handle('setViewedConversation', (id) => {
    const viewed = win?.isFocused() && !win.isMinimized() ? id : null;
    service.setViewedConversation(viewed);
    if (viewed) notifications?.dismiss(viewed);
  });
  handle('authorizeConnection', (id) => service.authorizeConnection(id));
  handle('saveConnection', (input) => service.saveConnection(input));
  handle('removeConnection', (input) => service.removeConnection(input));
  handle('testConnection', (input) => service.testConnection(input));
  handle('saveSkill', (input) => service.saveSkill(input));
  handle('removeSkill', (input) => service.removeSkill(input));
  handle('importPlugin', (input) => service.importPlugin(input));
  handle('removePlugin', (input) => service.removePlugin(input));
  handle('setConversationTools', (id, tools) => service.setConversationTools(id, tools));
  handle('saveAutomation', (input) => service.automations.save(input));
  handle('removeAutomation', (id) => service.automations.remove(id));
  handle('runAutomation', (id) => service.automations.run(id));
  handle('stopAutomationRun', (id) => service.automations.stop(id));
  handle('removeAutomationRun', (id) => service.automations.removeRun(id));
  handle('detectClis', () => Promise.all((['codex', 'claude'] as ProviderId[]).map((p) => detectCli(p, true))));
  handle('addAccount', (input) => service.addAccount(input));
  handle('updateAccount', (id, patch) => service.updateAccount(id, patch));
  handle('removeAccount', (id) => service.removeAccount(id));
  handle('checkAccount', (id) => service.checkAccount(id));
  handle('refreshUsage', (id) => service.refreshUsage(id));
  handle('listModels', (id) => service.listModels(id));
  handle('startLogin', (id, opts) => void service.startLogin(id, opts));
  handle('submitLoginCode', (id, code) => service.submitLoginCode(id, code));
  handle('cancelLogin', (id) => service.cancelLogin(id));
  handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Choose a working folder' });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('addProject', (input) => service.addProject(input));
  handle('updateProject', (id, patch) => service.updateProject(id, patch));
  handle('removeProject', (id) => service.removeProject(id));
  handle('createConversation', (input) => service.createConversation(input));
  handle('renameConversation', (id, title) => service.renameConversation(id, title));
  handle('archiveConversation', (id, archived) => service.archiveConversation(id, archived));
  handle('deleteConversation', async (id) => {
    const result = await service.deleteConversation(id);
    if (result.ok) notifications?.dismiss(id);
    return result;
  });
  handle('setConversationOptions', (id, options) => service.setConversationOptions(id, options));
  handle('attachFiles', (id, paths) => service.attachFiles(id, paths));
  handle('attachData', (id, name, data) => service.attachData(id, name, data));
  handle('pickFiles', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], title: 'Attach files' });
    return r.canceled ? [] : r.filePaths;
  });
  handle('getTranscript', (id) => store.transcript(id));
  handle('sendMessage', (id, text, opts) => service.sendMessage(id, text, { acknowledgeConflicts: opts?.acknowledgeConflicts, attachments: opts?.attachments }));
  handle('stop', (id) => service.stop(id));
  handle('respondApproval', (cid, iid, d) => service.respondApproval(cid, iid, d));
  handle('respondQuestion', (cid, iid, a) => service.respondQuestion(cid, iid, a));
  handle('folderConflicts', (id) => service.folderConflicts(id));
  handle('setSettings', (patch) => {
    service.setSettings(patch);
    if (patch.notifications === false) { notifications?.clear(); win?.flashFrame(false); }
    if (patch.theme) nativeTheme.themeSource = patch.theme;
  });
  handle('openExternal', (url) => safeOpen(url));
  const fileRoots = (id: string) => [...service.folders(service.conversation(id)), service.attachmentFolder(id)];
  handle('previewConversationFile', (id, target) => previewConversationFile(target, fileRoots(id)));
  handle('showConversationFile', async (id, target) => {
    const real = await resolveConversationFile(target, fileRoots(id));
    if ((await stat(real)).isDirectory()) {
      const error = await shell.openPath(real);
      if (error) throw new Error(error);
    } else shell.showItemInFolder(real);
  });
  handle('openConversationFolder', async (id) => {
    const folder = service.folders(service.conversation(id))[0];
    if (!folder || !(await stat(folder)).isDirectory()) throw new Error('Working folder not found.');
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });

  nativeTheme.themeSource = service.state.settings.theme;
  createWindow();
  service.automations.startScheduler();
  // Refresh connection status in the background; never blocks the UI.
  for (const a of service.state.accounts) void service.checkAccount(a.id);
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !service) return;
  e.preventDefault();
  quitting = true;
  void service.dispose().finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());
