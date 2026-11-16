import { BaseService, type Row } from '../base.service.js';
import { HttpError } from '../../shared/errors/http-error.js';

export type AvailabilityStatus = 'available' | 'unavailable' | 'on_leave';
export interface AvailabilityInput {
  officeId?: number;
  status: AvailabilityStatus;
  availableFrom?: string;
  availableUntil?: string;
  temporaryEligibility?: boolean;
}

const iso = (date = new Date()) => date.toISOString();

export class VolunteerService extends BaseService {
  optIn(employeeId: number): Row[] {
    const employee = this.requireRow('SELECT * FROM employees WHERE id = ?', employeeId, 'Employee');
    if (!employee.is_active) throw new HttpError(409, 'Inactive employees cannot volunteer');
    this.db.prepare(`INSERT INTO volunteer_availability (employee_id, office_id, is_volunteer, availability_status, available_from)
      VALUES (?, ?, 1, 'available', datetime('now'))
      ON CONFLICT(employee_id, office_id) WHERE office_id IS NOT NULL
      DO UPDATE SET is_volunteer = 1, availability_status = 'available', updated_at = datetime('now')`).run(employeeId, employee.office_id);
    return this.getVolunteerAvailability(employeeId);
  }

  optOut(employeeId: number): Row[] {
    this.requireRow('SELECT id FROM employees WHERE id = ?', employeeId, 'Employee');
    const active = this.one("SELECT id FROM assignments WHERE volunteer_employee_id = ? AND status IN ('offered','accepted') LIMIT 1", employeeId);
    if (active) throw new HttpError(409, 'A volunteer with an active assignment cannot opt out until it is resolved');
    this.db.prepare("UPDATE volunteer_availability SET is_volunteer = 0, updated_at = datetime('now') WHERE employee_id = ?").run(employeeId);
    return this.getVolunteerAvailability(employeeId);
  }

  updateAvailability(employeeId: number, input: AvailabilityInput): Row[] {
    const employee = this.requireRow('SELECT * FROM employees WHERE id = ?', employeeId, 'Employee');
    const officeId = input.officeId ?? Number(employee.office_id);
    this.requireRow('SELECT id FROM offices WHERE id = ?', officeId, 'Office');
    if (officeId !== employee.office_id && !input.temporaryEligibility) throw new HttpError(400, 'Temporary office eligibility must be explicitly enabled');
    if (input.availableUntil && input.availableFrom && input.availableUntil <= input.availableFrom) throw new HttpError(400, 'availableUntil must be later than availableFrom');
    if (officeId !== employee.office_id) {
      if (!input.availableUntil) throw new HttpError(400, 'Temporary office eligibility requires availableUntil');
      this.db.prepare(`INSERT INTO volunteer_office_eligibility (employee_id, office_id, available_from, available_until)
        VALUES (?, ?, ?, ?) ON CONFLICT(employee_id, office_id, available_from) DO UPDATE SET available_until = excluded.available_until`)
        .run(employeeId, officeId, input.availableFrom ?? iso(), input.availableUntil);
    }
    this.db.prepare(`INSERT INTO volunteer_availability
      (employee_id, office_id, is_volunteer, availability_status, available_from, available_until)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(employee_id, office_id) WHERE office_id IS NOT NULL
      DO UPDATE SET is_volunteer = 1, availability_status = excluded.availability_status,
      available_from = excluded.available_from, available_until = excluded.available_until, updated_at = datetime('now')`)
      .run(employeeId, officeId, input.status, input.availableFrom ?? iso(), input.availableUntil ?? null);
    return this.getVolunteerAvailability(employeeId);
  }

  listVolunteers(officeId?: number): Row[] {
    const where = officeId === undefined ? 'WHERE va.is_volunteer = 1' : 'WHERE va.office_id = ? AND va.is_volunteer = 1';
    const sql = `SELECT e.id employee_id, e.name, e.email, e.office_id home_office_id, va.office_id eligible_office_id,
      va.availability_status, va.available_from, va.available_until, va.is_volunteer
      FROM volunteer_availability va JOIN employees e ON e.id = va.employee_id ${where} ORDER BY e.id`;
    return officeId === undefined ? this.all(sql) : this.all(sql, officeId);
  }

  getVolunteerAvailability(employeeId: number): Row[] {
    return this.all('SELECT * FROM volunteer_availability WHERE employee_id = ? ORDER BY office_id', employeeId);
  }

  isEligibleAndAvailable(employeeId: number, officeId: number, at = new Date()): boolean {
    return Boolean(this.one(`SELECT e.id FROM employees e
      JOIN volunteer_availability va ON va.employee_id = e.id AND va.office_id = ?
      WHERE e.id = ? AND e.is_active = 1 AND va.is_volunteer = 1 AND va.availability_status = 'available'
        AND julianday(va.available_from) <= julianday(?) AND (va.available_until IS NULL OR julianday(va.available_until) > julianday(?))
        AND (e.office_id = ? OR EXISTS (
          SELECT 1 FROM volunteer_office_eligibility voe WHERE voe.employee_id = e.id AND voe.office_id = ?
          AND (voe.available_from IS NULL OR julianday(voe.available_from) <= julianday(?))
          AND (voe.available_until IS NULL OR julianday(voe.available_until) > julianday(?))
        ))`, officeId, employeeId, at.toISOString(), at.toISOString(), officeId, officeId, at.toISOString(), at.toISOString()));
  }

  /** Called from inside RefillsService's immediate transaction to serialize selection and assignment. */
  selectVolunteer(officeId: number, refillId: number): number | undefined {
    const now = iso();
    let rows = this.all(`SELECT e.id, MAX(a.assigned_at) last_assigned
      FROM employees e JOIN volunteer_availability va ON va.employee_id = e.id AND va.office_id = ?
      LEFT JOIN assignments a ON a.volunteer_employee_id = e.id
      WHERE e.is_active = 1 AND va.is_volunteer = 1 AND va.availability_status = 'available'
        AND julianday(va.available_from) <= julianday(?) AND (va.available_until IS NULL OR julianday(va.available_until) > julianday(?))
        AND (e.office_id = ? OR EXISTS (
          SELECT 1 FROM volunteer_office_eligibility voe WHERE voe.employee_id = e.id AND voe.office_id = ?
          AND (voe.available_from IS NULL OR julianday(voe.available_from) <= julianday(?))
          AND (voe.available_until IS NULL OR julianday(voe.available_until) > julianday(?))
        ))
        AND NOT EXISTS (SELECT 1 FROM assignments active WHERE active.volunteer_employee_id = e.id AND active.status IN ('offered','accepted'))
      GROUP BY e.id ORDER BY CASE WHEN e.office_id = ? THEN 0 ELSE 1 END ASC,
        COALESCE(last_assigned, '0000-01-01') ASC, e.id ASC`,
    officeId, now, now, officeId, officeId, now, now, officeId);
    const seen = new Set(this.all('SELECT volunteer_employee_id FROM assignments WHERE refill_request_id = ?', refillId).map((row) => Number(row.volunteer_employee_id)));
    const fresh = rows.filter((row) => !seen.has(Number(row.id)));
    if (fresh.length) rows = fresh;
    return rows.length ? Number(rows[0].id) : undefined;
  }
}
