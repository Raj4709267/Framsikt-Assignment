import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

export function openDatabase(path = env.DATABASE_PATH): Database.Database {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const database = new Database(absolutePath);
  database.pragma('foreign_keys = ON');
  return database;
}
