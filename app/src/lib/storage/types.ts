// The app talks to local data only through this interface. Today it is IndexedDB
// (dexie.ts); a native app can swap in SQLite without touching anything else.
import type { Capture, Item, SettingsDoc, SyncResponse } from '$shared/types';

export interface Config {
  /** Bearer token for the API. */
  token: string;
  /** Base URL of the Worker, no trailing slash. */
  api: string;
}

/** Local changes not yet accepted by the server: the outbox. */
export interface Outbox {
  captures: Capture[];
  items: Item[];
  settings: SettingsDoc | null;
}

export interface ExportData {
  app: 'unforget';
  formatVersion: 1;
  exportedAt: string;
  settings: SettingsDoc | null;
  captures: Capture[];
  items: Item[];
}

export interface Storage {
  loadConfig(): Promise<Config | null>;
  saveConfig(config: Config): Promise<void>;

  loadSettings(): Promise<SettingsDoc | null>;
  /** Saves settings and queues them for sync. */
  saveSettings(doc: SettingsDoc): Promise<void>;

  /** Everything that can appear on screen: not deleted, not archived. */
  loadItems(): Promise<Item[]>;
  getCapture(id: string): Promise<Capture | null>;
  /** Saves a capture with its items and queues them for sync. One transaction. */
  saveCapture(capture: Capture, items: Item[]): Promise<void>;
  /** Saves items and queues them for sync. */
  saveItems(items: Item[]): Promise<void>;

  /** Up to `limit` rows per kind that still need to reach the server. */
  outbox(limit: number): Promise<Outbox>;
  outboxSize(): Promise<number>;
  /** Ids of items the server has not accepted yet. */
  unsyncedItemIds(): Promise<string[]>;
  cursor(): Promise<number>;
  /**
   * Finishes one sync round in one transaction: marks what was sent as delivered
   * (unless it changed again meanwhile), merges what came back, stores the cursor.
   */
  applySync(sent: Outbox, response: SyncResponse): Promise<void>;

  exportAll(): Promise<ExportData>;
}
