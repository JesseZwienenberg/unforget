import Dexie, { type Table } from 'dexie';
import { incomingWins, mergeItem } from '$shared/merge';
import type { Capture, Item, SettingsDoc, SyncResponse } from '$shared/types';
import type { Config, ExportData, Outbox, Storage } from './types';

// `dirty` = 1 while a row still has to reach the server. Indexed, so the outbox
// is a cheap lookup.
type Stored<T> = T & { dirty: 0 | 1 };
interface Kv {
  key: string;
  value: unknown;
}

const strip = <T>({ dirty: _dirty, ...rest }: Stored<T>): T => rest as unknown as T;

// The database name is namespaced: another app shares this origin.
class UnforgetDb extends Dexie {
  captures!: Table<Stored<Capture>, string>;
  items!: Table<Stored<Item>, string>;
  kv!: Table<Kv, string>;

  constructor() {
    super('unforget');
    this.version(1).stores({
      captures: 'id, dirty',
      items: 'id, dirty, status, captureId',
      kv: 'key',
    });
  }
}

export class DexieStorage implements Storage {
  private readonly db = new UnforgetDb();

  private async get<T>(key: string): Promise<T | null> {
    return ((await this.db.kv.get(key))?.value as T | undefined) ?? null;
  }

  loadConfig(): Promise<Config | null> {
    return this.get<Config>('config');
  }

  async saveConfig(config: Config): Promise<void> {
    await this.db.kv.put({ key: 'config', value: config });
  }

  async loadSettings(): Promise<SettingsDoc | null> {
    const stored = await this.get<Stored<SettingsDoc>>('settings');
    return stored ? strip(stored) : null;
  }

  async saveSettings(doc: SettingsDoc): Promise<void> {
    await this.db.kv.put({ key: 'settings', value: { ...doc, dirty: 1 } });
  }

  async loadItems(): Promise<Item[]> {
    const rows = await this.db.items.where('status').anyOf('open', 'done').toArray();
    return rows.filter((r) => r.deletedAt === null).map(strip);
  }

  async loadArchived(limit: number): Promise<Item[]> {
    const rows = await this.db.items.where('status').equals('archived').toArray();
    return rows
      .filter((r) => r.deletedAt === null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(strip);
  }

  async getCapture(id: string): Promise<Capture | null> {
    const row = await this.db.captures.get(id);
    return row ? strip(row) : null;
  }

  async saveCapture(capture: Capture, items: Item[]): Promise<void> {
    await this.db.transaction('rw', this.db.captures, this.db.items, async () => {
      await this.db.captures.put({ ...capture, dirty: 1 });
      await this.db.items.bulkPut(items.map((i) => ({ ...i, dirty: 1 as const })));
    });
  }

  async saveItems(items: Item[]): Promise<void> {
    await this.db.items.bulkPut(items.map((i) => ({ ...i, dirty: 1 as const })));
  }

  async outbox(limit: number): Promise<Outbox> {
    const [captures, items, settings] = await Promise.all([
      this.db.captures.where('dirty').equals(1).limit(limit).toArray(),
      this.db.items.where('dirty').equals(1).limit(limit).toArray(),
      this.get<Stored<SettingsDoc>>('settings'),
    ]);
    return {
      captures: captures.map(strip),
      items: items.map(strip),
      settings: settings?.dirty === 1 ? strip(settings) : null,
    };
  }

  async outboxSize(): Promise<number> {
    const [captures, items, settings] = await Promise.all([
      this.db.captures.where('dirty').equals(1).count(),
      this.db.items.where('dirty').equals(1).count(),
      this.get<Stored<SettingsDoc>>('settings'),
    ]);
    return captures + items + (settings?.dirty === 1 ? 1 : 0);
  }

  async unsyncedItemIds(): Promise<string[]> {
    return this.db.items.where('dirty').equals(1).primaryKeys();
  }

  async cursor(): Promise<number> {
    return (await this.get<number>('cursor')) ?? 0;
  }

  async applySync(sent: Outbox, response: SyncResponse): Promise<void> {
    const { captures, items, kv } = this.db;
    await this.db.transaction('rw', captures, items, kv, async () => {
      // 1. What we sent has arrived, unless it was edited again while in flight.
      for (const s of sent.captures) {
        await captures.where('id').equals(s.id).modify((row) => {
          if (row.updatedAt === s.updatedAt) row.dirty = 0;
        });
      }
      for (const s of sent.items) {
        await items.where('id').equals(s.id).modify((row) => {
          if (row.updatedAt === s.updatedAt) row.dirty = 0;
        });
      }
      const localSettings = await this.get<Stored<SettingsDoc>>('settings');
      let settings = localSettings;
      if (settings && sent.settings && settings.updatedAt === sent.settings.updatedAt) settings = { ...settings, dirty: 0 };

      // 2. Merge what the server returned.
      const localCaptures = await captures.bulkGet(response.captures.map((c) => c.id));
      const capturePuts: Stored<Capture>[] = [];
      response.captures.forEach((incoming, i) => {
        const local = localCaptures[i];
        if (incomingWins(local, incoming, local?.dirty === 1)) capturePuts.push({ ...incoming, dirty: 0 });
        else if (local && local.sortStatus !== incoming.sortStatus) capturePuts.push({ ...local, sortStatus: incoming.sortStatus });
      });
      await captures.bulkPut(capturePuts);

      const localItems = await items.bulkGet(response.items.map((i) => i.id));
      const itemPuts: Stored<Item>[] = [];
      response.items.forEach((incoming, i) => {
        const local = localItems[i];
        const merged = mergeItem(local ? strip(local) : undefined, incoming, local?.dirty === 1);
        itemPuts.push({ ...merged.item, dirty: merged.dirty ? 1 : 0 });
      });
      await items.bulkPut(itemPuts);

      if (response.settings && incomingWins(settings ?? undefined, response.settings, settings?.dirty === 1)) {
        settings = { ...response.settings, dirty: 0 };
      }
      if (settings && settings !== localSettings) await kv.put({ key: 'settings', value: settings });

      await kv.put({ key: 'cursor', value: response.cursor });
    });
  }

  async exportAll(): Promise<ExportData> {
    const [captures, items, settings] = await Promise.all([
      this.db.captures.toArray(),
      this.db.items.toArray(),
      this.loadSettings(),
    ]);
    return {
      app: 'unforget',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      settings,
      captures: captures.map(strip).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
      items: items.map(strip).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  }
}
