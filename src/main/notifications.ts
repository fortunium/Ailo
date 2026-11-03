import { app, Notification, shell, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { MainEvent } from '../shared/types';
import type { AiloService } from './service';

const APP_ID = 'nl.ailo.desktop';

/** Windows needs a Start Menu identity even when launched through npm run dev. */
export function setupNotificationIdentity(icon: string): void {
  if (process.platform !== 'win32') return;
  app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
  if (app.isPackaged) return; // The installer creates the production shortcut.
  try {
    const shortcut = path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs/Ailo (development).lnk');
    fs.mkdirSync(path.dirname(shortcut), { recursive: true });
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : app.getAppPath();
    const written = shell.writeShortcutLink(shortcut, 'create', {
      target: process.execPath, args: `"${entry}"`, cwd: app.getAppPath(),
      appUserModelId: process.execPath, description: 'Ailo development', icon, iconIndex: 0
    });
    if (!written) console.warn('Ailo could not register its development notification shortcut.');
  } catch { console.warn('Ailo could not register its development notification shortcut.'); }
}

export class CompletionNotifications {
  private active = new Map<string, Notification>();
  constructor(private service: AiloService, private window: () => BrowserWindow | undefined, private icon: string) {}

  handle(event: MainEvent): void {
    if (event.type !== 'turn_finished') return;
    const c = this.service.state.conversations.find(c => c.id === event.conversationId);
    if (!c?.unread || this.service.state.settings.notifications === false) return;
    const win = this.window();
    if (!win || win.isDestroyed()) return;
    if (!win.isFocused()) win.flashFrame(true);
    this.dismiss(c.id);
    if (!Notification.isSupported()) return;
    try {
      // Keep command output, account details and response contents off the lock screen.
      const notification = new Notification({
        title: event.outcome === 'completed' ? 'Ailo — response ready' : 'Ailo — task failed',
        body: c.title.slice(0, 120), icon: this.icon
      });
      this.active.set(c.id, notification);
      notification.on('click', () => {
        const w = this.window();
        if (!w || w.isDestroyed() || !this.service.state.conversations.some(x => x.id === c.id)) return;
        if (w.isMinimized()) w.restore();
        w.show(); w.focus(); w.flashFrame(false);
        w.webContents.send('ailo:event', { type: 'open_conversation', conversationId: c.id } satisfies MainEvent);
      });
      const forget = () => { if (this.active.get(c.id) === notification) this.active.delete(c.id); };
      notification.on('close', forget);
      notification.on('failed', () => { forget(); console.warn('Ailo could not display a desktop notification.'); });
      notification.show();
    } catch { console.warn('Ailo could not display a desktop notification.'); }
  }

  dismiss(id: string): void {
    const notification = this.active.get(id);
    this.active.delete(id);
    notification?.close();
  }

  clear(): void { for (const id of [...this.active.keys()]) this.dismiss(id); }
}
