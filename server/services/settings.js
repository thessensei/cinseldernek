import { nowIso } from '../lib/text.js';

const DEFAULTS = { announcement: '', registration_open: '1' };

export function getSettings(db) {
  const settings = { ...DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) settings[row.key] = row.value;
  return settings;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, String(value), nowIso());
}

/** Herkese açık ayarlar (oturum gerektirmez). */
export function publicSettings(db) {
  const settings = getSettings(db);
  return {
    announcement: settings.announcement,
    registrationOpen: settings.registration_open === '1',
  };
}
