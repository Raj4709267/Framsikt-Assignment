import type Database from 'better-sqlite3';
import { env } from '../../config/env.js';
import type { ChatService } from '../../integrations/chat/chat.interface.js';
import { HttpError } from '../../shared/errors/http-error.js';
import { BaseService, type Row } from '../base.service.js';
import { EmployeeService } from '../employees/employee.service.js';
import { OfficeService } from '../offices/office.service.js';
import { VolunteerService } from '../volunteers/volunteer.service.js';

export interface CreateRefillInput { snackCounterId: number; reportedByEmployeeId: number; description: string }
const activeRefillStatuses = ['open', 'assigned', 'accepted', 'purchased'];
const iso = (date = new Date()) => date.toISOString();

export class RefillService extends BaseService {
  constructor(
    db: Database.Database,
    private readonly employees: EmployeeService,
    private readonly offices: OfficeService,
    private readonly volunteers: VolunteerService,
    private readonly chat: ChatService,
  ) { super(db); }

  private assignNext(refillId: number, reason: string, notifyWhenUnavailable = true): Row | undefined {
    const result = this.db.transaction(() => {
      const task = this.one('SELECT rr.*, sc.office_id FROM refill_requests rr JOIN snack_counters sc ON sc.id = rr.snack_counter_id WHERE rr.id = ?', refillId);
      if (!task || !['open', 'assigned', 'accepted'].includes(String(task.status))) return undefined;
      const existing = this.one("SELECT * FROM assignments WHERE refill_request_id = ? AND status IN ('offered','accepted')", refillId);
      if (existing) return { assignment: existing, officeId: Number(task.office_id), volunteerId: Number(existing.volunteer_employee_id), expiry: String(existing.expires_at), created: false };
      const volunteerId = this.volunteers.selectVolunteer(Number(task.office_id), refillId);
      if (!volunteerId) {
        this.db.prepare("UPDATE refill_requests SET status = 'open', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('completed','cancelled')").run(refillId);
        return { noVolunteer: true, officeId: Number(task.office_id) };
      }
      const expiry = iso(new Date(Date.now() + env.ASSIGNMENT_OFFER_TTL_HOURS * 3_600_000));
      const inserted = this.db.prepare(`INSERT INTO assignments (refill_request_id, volunteer_employee_id, status, expires_at, reassignment_reason)
        VALUES (?, ?, 'offered', ?, ?)`).run(refillId, volunteerId, expiry, reason || null);
      this.db.prepare("UPDATE refill_requests SET status = 'assigned', updated_at = datetime('now') WHERE id = ? AND status IN ('open','assigned')").run(refillId);
      return { assignment: this.one('SELECT * FROM assignments WHERE id = ?', Number(inserted.lastInsertRowid))!, officeId: Number(task.office_id), volunteerId, expiry, created: true };
    }).immediate();
    if (!result) return undefined;
    if ('noVolunteer' in result) {
      if (notifyWhenUnavailable) void this.chat.notifyOffice(result.officeId, `Refill ${refillId} is open; no eligible volunteer is currently available.`);
      return undefined;
    }
    if (result.created) void this.chat.notifyEmployee(result.volunteerId, `You have been offered refill task ${refillId}. Please accept before ${result.expiry}.`);
    return result.assignment;
  }

  createRefill(input: CreateRefillInput) {
    const employee = this.employees.getEmployee(input.reportedByEmployeeId);
    if (!employee.is_active) throw new HttpError(409, 'Inactive employees cannot report a refill');
    const counter = this.offices.getCounter(input.snackCounterId);
    if (!counter.is_active) throw new HttpError(409, 'Snack counter is inactive');
    const create = this.db.transaction(() => {
      const duplicate = this.one(`SELECT id FROM refill_requests WHERE snack_counter_id = ? AND status IN (${activeRefillStatuses.map(() => '?').join(',')})`, input.snackCounterId, ...activeRefillStatuses);
      if (duplicate) throw new HttpError(409, 'An active refill request already exists for this snack counter');
      const inserted = this.db.prepare(`INSERT INTO refill_requests (snack_counter_id, office_id, requested_by_employee_id, reported_by_employee_id, description, status)
        VALUES (?, ?, ?, ?, ?, 'open')`).run(input.snackCounterId, counter.office_id, input.reportedByEmployeeId, input.reportedByEmployeeId, input.description);
      return Number(inserted.lastInsertRowid);
    });
    const id = create.immediate();
    this.assignNext(id, 'initial assignment');
    void this.chat.notifyOffice(Number(counter.office_id), `A new refill was reported for ${String(counter.name)}: ${input.description}`);
    return this.getRefill(id);
  }

  listRefills(): Row[] {
    return this.all(`SELECT rr.*, sc.name counter_name, sc.location counter_location, o.name office_name
      FROM refill_requests rr JOIN snack_counters sc ON sc.id = rr.snack_counter_id
      JOIN offices o ON o.id = sc.office_id ORDER BY rr.created_at DESC`);
  }

  getRefill(id: number): Row & { assignments: Row[]; purchase: Row | null } {
    const task = this.requireRow(`SELECT rr.*, sc.name counter_name, sc.location counter_location, o.name office_name
      FROM refill_requests rr LEFT JOIN snack_counters sc ON sc.id = rr.snack_counter_id
      LEFT JOIN offices o ON o.id = COALESCE(sc.office_id, rr.office_id) WHERE rr.id = ?`, id, 'Refill request');
    return { ...task, assignments: this.all('SELECT * FROM assignments WHERE refill_request_id = ? ORDER BY id', id),
      purchase: this.one('SELECT * FROM purchases WHERE refill_request_id = ?', id) ?? null };
  }

  acceptRefill(refillId: number, employeeId: number) {
    const now = iso();
    const accept = this.db.transaction(() => {
      const assignment = this.one('SELECT * FROM assignments WHERE refill_request_id = ? AND volunteer_employee_id = ? ORDER BY id DESC LIMIT 1', refillId, employeeId);
      if (!assignment) {
        if (this.one("SELECT id FROM assignments WHERE refill_request_id = ? AND status IN ('offered','accepted')", refillId)) {
          throw new HttpError(409, 'This refill is assigned to another volunteer');
        }
        throw new HttpError(403, 'There is no offered assignment for this volunteer');
      }
      if (assignment.status !== 'offered') throw new HttpError(409, 'Assignment is no longer available');
      if (Number(this.one('SELECT julianday(?) <= julianday(?) expired', assignment.expires_at, now)?.expired)) throw new HttpError(409, 'This assignment has expired');
      const office = this.one('SELECT sc.office_id FROM refill_requests rr JOIN snack_counters sc ON sc.id = rr.snack_counter_id WHERE rr.id = ?', refillId);
      if (!office || !this.volunteers.isEligibleAndAvailable(employeeId, Number(office.office_id))) {
        throw new HttpError(409, 'Volunteer is no longer eligible and available for this office');
      }
      const updated = this.db.prepare("UPDATE assignments SET status = 'accepted', accepted_at = ?, expires_at = ? WHERE id = ? AND status = 'offered' AND julianday(expires_at) > julianday(?)")
        .run(now, iso(new Date(Date.now() + env.ASSIGNMENT_COMPLETION_TTL_HOURS * 3_600_000)), assignment.id, now);
      if (!updated.changes) throw new HttpError(409, 'Assignment is no longer available');
      const refill = this.db.prepare("UPDATE refill_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ? AND status = 'assigned'").run(refillId);
      if (!refill.changes) throw new HttpError(409, 'Refill request is no longer available');
    });
    accept.immediate();
    return this.getRefill(refillId);
  }

  declineRefill(refillId: number, employeeId: number) {
    const decline = this.db.transaction(() => {
      const refill = this.requireRow('SELECT status FROM refill_requests WHERE id = ?', refillId, 'Refill request');
      if (!['assigned', 'accepted'].includes(String(refill.status))) throw new HttpError(409, 'Refill request cannot be declined in its current state');
      const assignment = this.one("SELECT * FROM assignments WHERE refill_request_id = ? AND volunteer_employee_id = ? AND status IN ('offered','accepted')", refillId, employeeId);
      if (!assignment) throw new HttpError(403, 'There is no active assignment for this volunteer');
      this.db.prepare("UPDATE assignments SET status = 'declined' WHERE id = ? AND status IN ('offered','accepted')").run(assignment.id);
      this.db.prepare("UPDATE refill_requests SET status = 'open', updated_at = datetime('now') WHERE id = ? AND status IN ('assigned','accepted')").run(refillId);
    });
    decline.immediate();
    const next = this.assignNext(refillId, 'previous volunteer declined');
    void this.chat.notifyOffice(Number(this.one('SELECT office_id FROM refill_requests WHERE id = ?', refillId)?.office_id), `Volunteer ${employeeId} declined refill ${refillId}.`);
    return { refill: this.getRefill(refillId), assignment: next };
  }

  runAssignmentExpiryJob(now = new Date()) {
    const due = this.all(`SELECT a.id, a.refill_request_id FROM assignments a JOIN refill_requests rr ON rr.id = a.refill_request_id
      WHERE a.status IN ('offered','accepted') AND rr.status IN ('assigned','accepted') AND a.expires_at IS NOT NULL
      AND julianday(a.expires_at) <= julianday(?) ORDER BY a.expires_at`, iso(now));
    const results: Array<{ assignmentId: number; refillId: number; reassigned: boolean }> = [];
    for (const row of due) {
      const expired = this.db.transaction(() => {
        const updated = this.db.prepare("UPDATE assignments SET status = 'expired' WHERE id = ? AND status IN ('offered','accepted') AND julianday(expires_at) <= julianday(?)").run(row.id, iso(now));
        if (!updated.changes) return false;
        this.db.prepare("UPDATE refill_requests SET status = 'open', updated_at = datetime('now') WHERE id = ? AND status IN ('assigned','accepted')").run(row.refill_request_id);
        return true;
      }).immediate();
      if (!expired) continue;
      void this.chat.notifyOffice(Number(this.one('SELECT office_id FROM refill_requests WHERE id = ?', row.refill_request_id)?.office_id), `Assignment ${row.id} expired.`);
      const next = this.assignNext(Number(row.refill_request_id), 'previous assignment expired');
      results.push({ assignmentId: Number(row.id), refillId: Number(row.refill_request_id), reassigned: Boolean(next) });
    }
    const open = this.all(`SELECT rr.id FROM refill_requests rr WHERE rr.status = 'open'
      AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.refill_request_id = rr.id AND a.status IN ('offered','accepted')) ORDER BY rr.created_at`);
    for (const row of open) {
      const next = this.assignNext(Number(row.id), 'retry after no eligible volunteer was available', false);
      results.push({ assignmentId: 0, refillId: Number(row.id), reassigned: Boolean(next) });
    }
    return { processed: results.length, results };
  }

  completeRefill(refillId: number, employeeId: number) {
    const complete = this.db.transaction(() => {
      const refill = this.one('SELECT status FROM refill_requests WHERE id = ?', refillId);
      if (!refill) throw new HttpError(404, 'Refill request not found');
      if (refill.status === 'completed') throw new HttpError(409, 'Refill request is already completed');
      const assignment = this.one("SELECT * FROM assignments WHERE refill_request_id = ? AND volunteer_employee_id = ? AND status = 'accepted'", refillId, employeeId);
      if (!assignment) throw new HttpError(403, 'Only the assigned volunteer can complete this refill');
      if (!this.one('SELECT id FROM purchases WHERE refill_request_id = ?', refillId)) throw new HttpError(409, 'Record a purchase before completing the refill');
      const changed = this.db.prepare("UPDATE refill_requests SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'purchased'").run(refillId);
      if (!changed.changes) throw new HttpError(409, 'Refill cannot be completed from its current state');
      this.db.prepare("UPDATE assignments SET status = 'completed', completed_at = datetime('now') WHERE id = ? AND status = 'accepted'").run(assignment.id);
    });
    complete.immediate();
    return this.getRefill(refillId);
  }

  cancelRefill(refillId: number) {
    const cancel = this.db.transaction(() => {
      const task = this.requireRow('SELECT * FROM refill_requests WHERE id = ?', refillId, 'Refill request');
      if (!['open', 'assigned', 'accepted'].includes(String(task.status))) throw new HttpError(409, 'Refill request cannot be cancelled in its current state');
      this.db.prepare("UPDATE refill_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(refillId);
      this.db.prepare("UPDATE assignments SET status = 'cancelled' WHERE refill_request_id = ? AND status IN ('offered','accepted')").run(refillId);
      this.db.prepare("UPDATE budget_reservations SET status = 'released', updated_at = datetime('now') WHERE refill_request_id = ? AND status = 'reserved'").run(refillId);
    });
    cancel.immediate();
    return this.getRefill(refillId);
  }
}
