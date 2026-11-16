import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { openDatabase } from './connection.js';

const localMigrations = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrationsDirectory = existsSync(localMigrations) ? localMigrations : resolve('src/database/migrations');

export function migrateDatabase(database: Database.Database): string[] {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set((database.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map(({ name }) => name));
  const newlyApplied: string[] = [];
  for (const name of readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(migrationsDirectory, name), 'utf8');
    database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    })();
    newlyApplied.push(name);
  }
  return newlyApplied;
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  const database = openDatabase();
  try {
    const migrations = migrateDatabase(database);
    for (const migration of migrations) console.info(`Applied migration ${migration}`);
    if (!migrations.length) console.info('Database is already up to date.');
  } finally {
    database.close();
  }
}
