import { BaseService, type Row } from '../base.service.js';

export interface CreateEmployeeInput { name: string; email: string; officeId: number }
export interface UpdateEmployeeInput { name?: string; email?: string; officeId?: number; isActive?: boolean }

export class EmployeeService extends BaseService {
  listEmployees(officeId?: number): Row[] {
    return officeId === undefined
      ? this.all('SELECT * FROM employees ORDER BY id')
      : this.all('SELECT * FROM employees WHERE office_id = ? ORDER BY id', officeId);
  }

  getEmployee(id: number): Row { return this.requireRow('SELECT * FROM employees WHERE id = ?', id, 'Employee'); }

  createEmployee(input: CreateEmployeeInput): Row {
    this.requireRow('SELECT id FROM offices WHERE id = ?', input.officeId, 'Office');
    const result = this.db.prepare('INSERT INTO employees (name, email, office_id) VALUES (?, ?, ?)')
      .run(input.name, input.email.toLowerCase(), input.officeId);
    return this.getEmployee(Number(result.lastInsertRowid));
  }

  updateEmployee(id: number, patch: UpdateEmployeeInput): Row {
    this.getEmployee(id);
    if (patch.officeId !== undefined) this.requireRow('SELECT id FROM offices WHERE id = ?', patch.officeId, 'Office');
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of [['name', 'name'], ['email', 'email'], ['officeId', 'office_id'], ['isActive', 'is_active']] as const) {
      const value = patch[key];
      if (value !== undefined) {
        fields.push(`${column} = ?`);
        values.push(key === 'email' ? String(value).toLowerCase() : key === 'isActive' ? Number(value) : value);
      }
    }
    if (fields.length) this.db.prepare(`UPDATE employees SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
    return this.getEmployee(id);
  }

  setActive(id: number, isActive: boolean): Row {
    return this.updateEmployee(id, { isActive });
  }
}
