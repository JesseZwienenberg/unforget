import { DEFAULT_SETTINGS, withDefaults, type Settings } from '../../shared/src/settings';

export async function loadSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare('SELECT json FROM settings WHERE id = 1').first<{ json: string }>();
  if (!row) return DEFAULT_SETTINGS;
  try {
    return withDefaults(JSON.parse(row.json));
  } catch {
    return DEFAULT_SETTINGS;
  }
}
