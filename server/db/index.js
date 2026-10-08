import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  MIGRATIONS.forEach((sql, index) => {
    const version = index + 1;
    if (version <= current) return;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  });
}

const SLUG_TABLES = new Set(['posts', 'rooms']);

/** Tablo içinde benzersiz slug üretir: base, base-2, base-3 ... */
export function uniqueSlug(db, table, base, excludeId = null) {
  if (!SLUG_TABLES.has(table)) throw new Error(`Desteklenmeyen tablo: ${table}`);
  let root = base || 'icerik';
  if (/^\d+$/.test(root)) root = `${table === 'rooms' ? 'oda' : 'yazi'}-${root}`;
  const check = db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id IS NOT ?`);
  let candidate = root;
  let counter = 2;
  while (check.get(candidate, excludeId)) {
    candidate = `${root}-${counter}`;
    counter += 1;
  }
  return candidate;
}
