import type Database from 'better-sqlite3';
import { HttpError } from '../shared/errors/http-error.js';

export type Row = Record<string, unknown>;

export abstract class BaseService {
  constructor(protected readonly db: Database.Database) {}

  protected one(sql: string, ...params: unknown[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }

  protected all(sql: string, ...params: unknown[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  protected requireRow(sql: string, id: number, label: string): Row {
    const row = this.one(sql, id);
    if (!row) throw new HttpError(404, `${label} not found`);
    return row;
  }
}
