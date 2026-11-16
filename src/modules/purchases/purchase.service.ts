import type Database from 'better-sqlite3';
import { BaseService, type Row } from '../base.service.js';
import { BudgetService } from '../budgets/budget.service.js';
import type { ChatService } from '../../integrations/chat/chat.interface.js';
import type { HrService } from '../../integrations/hr/hr.interface.js';
import { HttpError } from '../../shared/errors/http-error.js';

export interface PurchaseInput { amount: number; currency: string; description: string; purchasedAt?: string; receiptPath: string }

const iso = (date: Date) => date.toISOString();

export class PurchaseService extends BaseService {
  constructor(db: Database.Database, private readonly budgets: BudgetService, private readonly chat: ChatService, private readonly hr: HrService) { super(db); }

  async purchaseRefill(refillId: number, employeeId: number, input: PurchaseInput) {
    const purchasedAt = input.purchasedAt ? new Date(input.purchasedAt) : new Date();
    if (Number.isNaN(purchasedAt.getTime())) throw new HttpError(400, 'Invalid purchase date');
    const actualAt = iso(purchasedAt);
    const result = this.db.transaction(() => {
      const task = this.one(`SELECT rr.*, sc.office_id, o.currency, o.monthly_budget
        FROM refill_requests rr JOIN snack_counters sc ON sc.id = rr.snack_counter_id
        JOIN offices o ON o.id = sc.office_id WHERE rr.id = ?`, refillId);
      if (!task) throw new HttpError(404, 'Refill request not found');
      if (task.status !== 'accepted') throw new HttpError(409, 'Only an accepted refill can be purchased');
      const assignment = this.one("SELECT id FROM assignments WHERE refill_request_id = ? AND volunteer_employee_id = ? AND status = 'accepted'", refillId, employeeId);
      if (!assignment) throw new HttpError(403, 'Only the assigned volunteer can submit this purchase');
      if (input.currency !== task.currency) throw new HttpError(400, `Purchase currency must match the office currency (${String(task.currency)})`);
      const officeForBudget = { id: Number(task.office_id), currency: task.currency, monthly_budget: task.monthly_budget };
      const reservationId = this.budgets.reservePurchase(refillId, officeForBudget, purchasedAt, input.amount, input.currency);
      const amountMinor = Math.round(input.amount * 100);
      const purchase = this.db.prepare(`INSERT INTO purchases (refill_request_id, volunteer_employee_id, purchased_by_employee_id,
        amount, amount_minor, currency, description, receipt_path, purchased_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(refillId, employeeId, employeeId, input.amount, amountMinor, input.currency, input.description, input.receiptPath, actualAt);
      const updated = this.db.prepare("UPDATE refill_requests SET status = 'purchased', updated_at = datetime('now') WHERE id = ? AND status = 'accepted'").run(refillId);
      if (!updated.changes) throw new HttpError(409, 'Refill request is no longer available for purchase');
      this.db.prepare("UPDATE budget_reservations SET status = 'converted', updated_at = datetime('now') WHERE id = ? AND status = 'reserved'").run(reservationId);
      const reimbursement = this.db.prepare(`INSERT INTO reimbursements (purchase_id, employee_id, amount, currency, status)
        VALUES (?, ?, ?, ?, 'pending_submission')`).run(purchase.lastInsertRowid, employeeId, input.amount, input.currency);
      return { purchaseId: Number(purchase.lastInsertRowid), reimbursementId: Number(reimbursement.lastInsertRowid), officeId: Number(task.office_id) };
    }).immediate();

    const purchase = this.requireRow('SELECT * FROM purchases WHERE id = ?', result.purchaseId, 'Purchase');
    try {
      const claim = await this.hr.submitClaim({ employeeId, amount: input.amount, currency: input.currency, description: input.description,
        receiptPath: input.receiptPath, idempotencyKey: `purchase:${result.purchaseId}` });
      this.db.prepare("UPDATE reimbursements SET hr_claim_id = ?, status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status IN ('pending_submission','submission_failed')")
        .run(claim.claimId, result.reimbursementId);
      void this.chat.notifyEmployee(employeeId, `Your purchase for refill ${refillId} was submitted to HR as claim ${claim.claimId}.`);
    } catch {
      this.db.prepare("UPDATE reimbursements SET status = 'submission_failed', updated_at = datetime('now') WHERE id = ?").run(result.reimbursementId);
      void this.chat.notifyEmployee(employeeId, `Purchase saved for refill ${refillId}, but HR claim submission failed. It can be retried.`);
    }
    void this.chat.notifyOffice(result.officeId, `Purchase recorded for refill ${refillId}.`);
    return { purchase, reimbursement: this.requireRow('SELECT * FROM reimbursements WHERE id = ?', result.reimbursementId, 'Reimbursement') };
  }
}
