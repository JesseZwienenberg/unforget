// The app's state and every action the screens can take. Screens stay dumb.
import { createCapture } from '$shared/capture';
import { DEFAULT_SETTINGS, type Settings } from '$shared/settings';
import { resolveSnooze } from '$shared/snooze';
import { formatWhen } from '$shared/time';
import { LIST_NAMES, type CaptureSource, type Item, type ListId } from '$shared/types';
import { downloadJson } from './export';
import { cleanUrl, parseOpenItem, parseSetupLink, parseShare } from './launch';
import { currentPushState, sendTest, subscribe, type PushState } from './push';
import { registerServiceWorker, requestPersistentStorage, type ShellStatus } from './pwa';
import { DexieStorage } from './storage/dexie';
import type { Config, Storage } from './storage/types';
import { OfflineError, runSync, UnauthorizedError } from './sync';

export type Tab = 'today' | ListId;
export type SyncState = 'unconfigured' | 'idle' | 'syncing' | 'offline' | 'unauthorized' | 'error';

export interface Toast {
  key: number;
  text: string;
  /** A second line that must not be missed, e.g. "not scheduled yet: offline". */
  warning?: string | null;
  /** Tapping the toast opens this item for a quick fix. */
  itemId: string | null;
  /** The capture this toast is about, so it can be refreshed when the sorter answers. */
  captureId?: string;
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

  /** Items the server has not accepted yet: their reminders are not scheduled. */
  unsynced = $state.raw<ReadonlySet<string>>(new Set());
  pushState = $state<PushState>('unsupported');
  pushBusy = $state(false);
  pushNote = $state<string | null>(null);
  /** The item whose snooze sheet is open (after tapping a notification). */
  snoozingId = $state<string | null>(null);
  /** Set by the capture box, so a tap anywhere can open the keyboard. */
  focusBox: () => void = () => {};
  private wantedItemId: string | null = null;

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

  get snoozing(): Item | null {
    return this.items.find((i) => i.id === this.snoozingId && i.status !== 'archived') ?? null;
  }

  /** Why a reminder is not scheduled on the server yet, or null when it is (or there is none). */
  notScheduled(item: Item): string | null {
    if (!item.remindAt || item.status !== 'open' || item.notifiedAt) return null;
    if (this.syncState === 'unconfigured') return 'not scheduled: this device is not connected';
    if (!this.unsynced.has(item.id)) return null;
    if (this.syncState === 'offline') return 'not scheduled yet: offline';
    if (this.syncState === 'unauthorized' || this.syncState === 'error') return 'not scheduled yet: sync problem';
    return null; // a sync is on its way
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
    this.wantedItemId = parseOpenItem(location.search);
    if (setup || shared || this.wantedItemId) history.replaceState(null, '', cleanUrl(location.href));

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
    await this.refreshOutbox();
    this.syncState = config ? (navigator.onLine ? 'idle' : 'offline') : 'unconfigured';
    this.ready = true;
    this.openWanted();

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
    ).then(() => this.startPush());
    void requestPersistentStorage();

    // The service worker speaks up when a notification was tapped or a button on it was used.
    navigator.serviceWorker?.addEventListener('message', (event) => {
      const data = event.data as { type?: string; itemId?: string | null } | null;
      if (data?.type === 'sync') this.requestSync();
      if (data?.type === 'open-item') {
        this.wantedItemId = data.itemId ?? null;
        if (!data.itemId) this.tab = 'today';
        this.openWanted();
        this.requestSync();
      }
    });
  }

  // ---- notifications -----------------------------------------------------

  private async startPush(): Promise<void> {
    this.pushState = await currentPushState();
    // Permission already given: (re)register quietly, so the server always has a working subscription.
    if (this.config && Notification.permission === 'granted' && this.pushState !== 'unsupported') {
      try {
        await subscribe(this.config);
        this.pushState = 'on';
      } catch (err) {
        console.warn('push refresh failed', err);
      }
    }
  }

  /** Must be called from a tap: the browser only asks for permission then. */
  async enableNotifications(): Promise<void> {
    if (!this.config) {
      this.pushNote = 'Connect this device first (open your setup link).';
      return;
    }
    this.pushBusy = true;
    this.pushNote = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.pushState = permission === 'denied' ? 'blocked' : 'off';
        return;
      }
      await subscribe(this.config);
      this.pushState = 'on';
      this.pushNote = 'Notifications are on for this device.';
    } catch (err) {
      this.pushNote = `Could not turn notifications on: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.pushBusy = false;
    }
  }

  async testNotification(): Promise<void> {
    if (!this.config) return;
    this.pushBusy = true;
    this.pushNote = null;
    try {
      const r = await sendTest(this.config);
      this.pushNote =
        r.devices === 0
          ? 'No device has notifications turned on.'
          : r.delivered === r.devices
            ? `Sent to ${r.devices} ${r.devices === 1 ? 'device' : 'devices'}. It should appear within a few seconds.`
            : `Sent to ${r.delivered} of ${r.devices} devices. Problem: ${r.errors[0] ?? 'unknown'}`;
    } catch (err) {
      this.pushNote = `Test failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.pushBusy = false;
    }
  }

  /** Opens the snooze sheet for the item a notification was about, once that item is on this device. */
  private openWanted(): void {
    if (!this.wantedItemId) return;
    const item = this.items.find((i) => i.id === this.wantedItemId);
    if (!item) return; // not here yet: tried again after the next sync
    this.wantedItemId = null;
    if (item.status === 'open') {
      this.dismissToast();
      this.snoozingId = item.id;
    }
  }

  /** Snoozes to a preset ('1h', 'tonight', …) or to an exact time. */
  async snooze(id: string, to: string | Date): Promise<void> {
    const until = typeof to === 'string' ? resolveSnooze(to, new Date(), this.settings) : to;
    this.snoozingId = null;
    if (!until) return;
    const item = await this.change(id, { remindAt: until.toISOString(), notifiedAt: null, status: 'open' });
    if (item?.remindAt) {
      this.showToast({ text: `Snoozed → ⏰ ${formatWhen(item.remindAt, this.timeZone, this.now)} · ${item.title}`, warning: this.offlineWarning(), itemId: null, undo: null });
    }
  }

  private offlineWarning(): string | null {
    if (!this.config) return 'not scheduled: this device is not connected';
    return navigator.onLine ? null : 'not scheduled yet: offline';
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
      warning: item.remindAt ? this.offlineWarning() : null,
      itemId: item.id,
      captureId: capture.id,
      undo: () => void this.undoCapture(capture.id),
    });
    await this.storage.saveCapture(capture, [item]);
    this.afterWrite();
  }

  /** The sorter answered while the toast is still up: show what the capture became. */
  private refreshToast(): void {
    const toast = this.toast;
    if (!toast?.captureId) return;
    const items = this.items.filter((i) => i.captureId === toast.captureId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const first = items.find((i) => i.id === toast.itemId) ?? items[0];
    const text = !first
      ? 'Saved → Groceries · already on the list, quantity raised'
      : items.length === 1
        ? this.savedText(first)
        : `Saved → ${items.length} items · ${[first, ...items.filter((i) => i !== first)].map((i) => i.title).join(' · ')}`;
    if (text === toast.text) return;
    this.showToast({ ...toast, text, itemId: first?.id ?? null });
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
    if (this.snoozingId === id) this.snoozingId = null;
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

  private async refreshOutbox(): Promise<void> {
    const [size, ids] = await Promise.all([this.storage.outboxSize(), this.storage.unsyncedItemIds()]);
    this.waiting = size;
    this.unsynced = new Set(ids);
  }

  private afterWrite(): void {
    void this.refreshOutbox();
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
          this.refreshToast();
          this.openWanted();
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
      await this.refreshOutbox();
    }
  }

  // ---- settings ----------------------------------------------------------

  /** Changes settings on this device and queues them for sync to the server and other devices. */
  async updateSettings(change: (current: Settings) => Settings): Promise<void> {
    const value = change(this.settings);
    this.settings = value;
    await this.storage.saveSettings({ value, updatedAt: new Date().toISOString() });
    this.afterWrite();
  }

  // ---- export ------------------------------------------------------------

  async exportEverything(): Promise<void> {
    downloadJson(await this.storage.exportAll());
  }
}

export const app = new App();
