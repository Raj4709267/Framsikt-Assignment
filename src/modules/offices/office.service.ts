import { BaseService, type Row } from '../base.service.js';

export interface CreateCounterInput { officeId: number; name: string; location: string }
export interface UpdateCounterInput { name?: string; location?: string; isActive?: boolean }

export class OfficeService extends BaseService {
  listOffices(): Row[] { return this.all('SELECT * FROM offices ORDER BY id'); }
  getOffice(id: number): Row { return this.requireRow('SELECT * FROM offices WHERE id = ?', id, 'Office'); }

  listCounters(officeId?: number): Row[] {
    return officeId === undefined
      ? this.all('SELECT * FROM snack_counters ORDER BY id')
      : this.all('SELECT * FROM snack_counters WHERE office_id = ? ORDER BY id', officeId);
  }
  getCounter(id: number): Row { return this.requireRow('SELECT * FROM snack_counters WHERE id = ?', id, 'Snack counter'); }

  createCounter(input: CreateCounterInput): Row {
    this.getOffice(input.officeId);
    const result = this.db.prepare('INSERT INTO snack_counters (office_id, name, location) VALUES (?, ?, ?)')
      .run(input.officeId, input.name, input.location);
    return this.getCounter(Number(result.lastInsertRowid));
  }

  updateCounter(id: number, patch: UpdateCounterInput): Row {
    this.getCounter(id);
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.location !== undefined) { fields.push('location = ?'); values.push(patch.location); }
    if (patch.isActive !== undefined) { fields.push('is_active = ?'); values.push(Number(patch.isActive)); }
    if (fields.length) this.db.prepare(`UPDATE snack_counters SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
    return this.getCounter(id);
  }
}
