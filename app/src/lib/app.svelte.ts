// The app's state and every action the screens can take. Screens stay dumb.
import { createCapture } from '$shared/capture';
import { DEFAULT_SETTINGS, type Settings } from '$shared/settings';
import { formatWhen } from '$shared/time';
import { LIST_NAMES, type CaptureSource, type Item, type ListId } from '$shared/types';
import { downloadJson } from './export';
import { cleanUrl, parseSetupLink, parseShare } from './launch';
import { registerServiceWorker, requestPersistentStorage, type ShellStatus } from './pwa';
import { DexieStorage } from './storage/dexie';
import type { Config, Storage } from './storage/types';
import { OfflineError, runSync, UnauthorizedError } from './sync';

export type Tab = 'today' | ListId;
export type SyncState = 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error';

export interface Toast {
  key: number;
  text: string;
  /** Tapping the toast opens this item for a quick fix. */
  itemId: string | null;
  undo: (() => void) | null;
}

const TOAST_MS = 6000;
const SYNC_EVERY_MS = 60_000;
const newId = (): string => crypto.randomUUID();

class App {
  ready = $state(false);
  items = $state.raw<Item[]>([]);
  settings = $state.raw<Settings>(DEFAULT_SETTINGS);
  tab = $state<Tab>('today');
  now = $state(new Date());

  syncState = $state<SyncState>('unconfigured');
  syncError = $state<string | null>(null);
  waiting = $state(0);
  lastSyncedAt = $state<Date | null>(null);
  online = $state(navigator.onLine);

  toast = $state<Toast | null>(null);
  editingId = $state<string | null>(null);
  moreOpen = $state(false);
  shell = $state<ShellStatus>('installing');
  updateReady = $state(false);
  apiHost = $state<string | null>(null);

  private storage: Storage = new DexieStorage();
  private config: Config | null = null;
  private started: Promise<void> | null = null;
  private syncing = false;
  private syncAgain = false;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private toastKey = 0;

  get timeZone(): string {
    return this.settings.timeZone;
  }

  get editing(): Item | null {
    return this.items.find((i) => i.id === this.editingId) ?? null;
  }

  /** Loads local data and wires up background work. Safe to call more than once. */
  start(): Promise<void> {
    this.started ??= this.init();
    return this.started;
  }

  private async init(): Promise<void> {
    // The one-time setup link: keep the token locally, then scrub it from the address bar.
    const setup = parseSetupLink(location.hash);
    const shared = parseShare(location.search);
    if (setup || shared) history.replaceState(null, '', cleanUrl(location.href));

    if (setup) await this.storage.saveConfig(setup);
    const [config, settings, items] = await Promise.all([
      this.storage.loadConfig(),
      this.storage.loadSettings(),
      this.storage.loadItems(),
    ]);
    this.config = config;
    this.apiHost = config ? new URL(config.api).host : null;
    if (settings) this.settings = settings.value;
    this.items = items;
    this.waiting = await this.storage.outboxSize();
    this.syncState = config ? 'idle' : 'unconfigured';
    this.ready = true;

    if (setup) this.showToast({ text: 'Connected. Syncing…', itemId: null, undo: null });
    if (shared) void this.capture(shared, 'share');

    window.addEventListener('online', () => {
      this.online = true;
      this.requestSync();
    });
    window.addEventListener('offline', () => {
      this.online = false;
      if (this.config) this.syncState = 'offline';
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.now = new Date();
        this.requestSync();
      }
    });
    setInterval(() => {
      this.now = new Date();
    }, 20_000);
    setInterval(() => {
      if (document.visibilityState === 'visible') this.requestSync();
    }, SYNC_EVERY_MS);

    this.requestSync();
    void registerServiceWorker(
      (s) => (this.shell = s),
      () => (this.updateReady = true),
    );
    void requestPersistentStorage();
  }

  // ---- capture -----------------------------------------------------------

  /** The single entry point for every capture input (text box, share sheet, later a widget). */
  async capture(text: string, source: CaptureSource): Promise<void> {
    const typedAt = new Date(); // before any waiting: relative times count from here
    if (!text.trim()) return;
    await this.start();
    const { capture, item } = createCapture(text, source, typedAt, this.settings, newId);
    this.items = [...this.items, item];
    this.now = typedAt;
    this.showToast({
      text: this.savedText(item),
      itemId: item.id,
      undo: () => void this.undoCapture(capture.id),
    });
    await this.storage.saveCapture(capture, [item]);
    this.afterWrite();
  }

  private savedText(item: Item): string {
    const when = item.remindAt ? ` · ⏰ ${formatWhen(item.remindAt, this.timeZone, this.now)}` : '';
    return `Saved → ${LIST_NAMES[item.list]}${when} · ${item.title}`;
  }

  private async undoCapture(captureId: string): Promise<void> {
    const stamp = new Date().toISOString();
    const gone = this.items.filter((i) => i.captureId === captureId).map((i) => ({ ...i, deletedAt: stamp, updatedAt: this.bump(i, stamp) }));
    this.items = this.items.filter((i) => i.captureId !== captureId);
    this.dismissToast();
    const capture = await this.storage.getCapture(captureId);
    if (capture) await this.storage.saveCapture({ ...capture, deletedAt: stamp, updatedAt: this.bump(capture, stamp) }, gone);
    this.afterWrite();
  }

  // ---- items -------------------------------------------------------------

  /** A new updatedAt that is always later than the old one, even if the clock moved back. */
  private bump(old: { updatedAt: string }, stamp: string): string {
    return stamp > old.updatedAt ? stamp : new Date(Date.parse(old.updatedAt) + 1).toISOString();
  }

  private async change(id: string, patch: Partial<Item>, touch = true): Promise<Item | null> {
    const old = this.items.find((i) => i.id === id);
    if (!old) return null;
    const stamp = new Date().toISOString();
    const next: Item = { ...old, ...patch, updatedAt: this.bump(old, stamp), touchedAt: touch ? stamp : old.touchedAt };
    this.items = next.deletedAt ? this.items.filter((i) => i.id !== id) : this.items.map((i) => (i.id === id ? next : i));
    await this.storage.saveItems([next]);
    this.afterWrite();
    return next;
  }

  async setDone(id: string, done: boolean): Promise<void> {
    const item = await this.change(id, { status: done ? 'done' : 'open' });
    if (item && done) this.showToast({ text: `Done · ${item.title}`, itemId: null, undo: () => void this.setDone(id, false) });
    else if (item) this.dismissToast();
  }

  /** Puts a ticked grocery back on the list. */
  async readd(id: string): Promise<void> {
    await this.change(id, { status: 'open' });
  }

  /** Saves a manual fix. A hand-edited item is no longer provisional: the sorter must not overwrite it. */
  async saveEdit(id: string, patch: Pick<Item, 'title' | 'list' | 'remindAt' | 'dueAt'>): Promise<void> {
    await this.change(id, { ...patch, provisional: false, unsorted: false });
    this.editingId = null;
  }

  async remove(id: string): Promise<void> {
    const old = this.items.find((i) => i.id === id);
    this.editingId = null;
    if (!old) return;
    await this.change(id, { deletedAt: new Date().toISOString() });
  }

  edit(id: string): void {
    this.dismissToast();
    this.editingId = id;
  }

  // ---- toast -------------------------------------------------------------

  private showToast(t: Omit<Toast, 'key'>): void {
    clearTimeout(this.toastTimer);
    this.toast = { ...t, key: ++this.toastKey };
    this.toastTimer = setTimeout(() => (this.toast = null), TOAST_MS);
  }

  dismissToast(): void {
    clearTimeout(this.toastTimer);
    this.toast = null;
  }

  // ---- sync --------------------------------------------------------------

  private afterWrite(): void {
    void this.storage.outboxSize().then((n) => (this.waiting = n));
    this.requestSync();
  }

  /** Starts a sync unless one is running; in that case one more runs right after. Never blocks typing. */
  requestSync(): void {
    if (!this.config) return;
    if (!navigator.onLine) {
      this.syncState = 'offline';
      return;
    }
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    void this.sync(this.config);
  }

  private async sync(config: Config): Promise<void> {
    this.syncing = true;
    this.syncState = 'syncing';
    try {
      do {
        this.syncAgain = false;
        const { received } = await runSync(this.storage, config);
        if (received) {
          const [items, settings] = await Promise.all([this.storage.loadItems(), this.storage.loadSettings()]);
          this.items = items;
          if (settings) this.settings = settings.value;
        }
      } while (this.syncAgain);
      this.syncState = 'idle';
      this.syncError = null;
      this.lastSyncedAt = new Date();
    } catch (err) {
      if (err instanceof OfflineError) this.syncState = 'offline';
      else if (err instanceof UnauthorizedError) this.syncState = 'unauthorized';
      else {
        this.syncState = 'error';
        this.syncError = err instanceof Error ? err.message : String(err);
        console.error(err);
      }
    } finally {
      this.syncing = false;
      this.waiting = await this.storage.outboxSize();
    }
  }

  // ---- export ------------------------------------------------------------

  async exportEverything(): Promise<void> {
    downloadJson(await this.storage.exportAll());
  }
}

export const app = new App();
