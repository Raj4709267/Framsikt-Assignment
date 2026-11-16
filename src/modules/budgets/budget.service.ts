import { BaseService, type Row } from '../base.service.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../shared/errors/http-error.js';

export interface SetBudgetInput { officeId: number; year: number; month: number; budgetAmount: number }

export class BudgetService extends BaseService {
  private budgetFor(office: Row, year: number, month: number) {
    const stored = this.one('SELECT * FROM monthly_budgets WHERE office_id = ? AND year = ? AND month = ?', office.id, year, month);
    const budget = stored ? Number(stored.budget_amount) : Number(office.monthly_budget) / 100;
    const totals = this.one(`SELECT COALESCE(SUM(p.amount), 0) spent,
      SUM(CASE WHEN r.status IN ('pending_submission','submission_failed','submitted') THEN r.amount ELSE 0 END) pending,
      SUM(CASE WHEN r.status = 'approved' THEN r.amount ELSE 0 END) approved,
      SUM(CASE WHEN r.status = 'reimbursed' THEN r.amount ELSE 0 END) reimbursed
      FROM purchases p JOIN refill_requests rr ON rr.id = p.refill_request_id JOIN snack_counters sc ON sc.id = rr.snack_counter_id
      LEFT JOIN reimbursements r ON r.purchase_id = p.id
      WHERE sc.office_id = ? AND strftime('%Y', p.purchased_at) = ? AND strftime('%m', p.purchased_at) = ?`,
    office.id, String(year), String(month).padStart(2, '0')) ?? {};
    const reserved = Number(this.one("SELECT COALESCE(SUM(amount), 0) total FROM budget_reservations WHERE office_id = ? AND year = ? AND month = ? AND status = 'reserved'", office.id, year, month)?.total ?? 0);
    const spent = Number(totals.spent ?? 0);
    return { officeId: office.id, officeName: office.name, currency: office.currency, year, month, monthlyBudget: budget,
      actualPurchaseSpending: spent, approvedSpending: Number(totals.approved ?? 0), pendingReimbursementAmounts: Number(totals.pending ?? 0),
      paidReimbursements: Number(totals.reimbursed ?? 0), reservedCommitments: reserved, remainingBudget: budget - spent - reserved,
      utilizationPercent: budget ? Math.round((spent + reserved) / budget * 10000) / 100 : 0 };
  }

  getBudget(officeId: number, year = new Date().getUTCFullYear(), month = new Date().getUTCMonth() + 1) {
    if (month < 1 || month > 12) throw new HttpError(400, 'Month must be between 1 and 12');
    return this.budgetFor(this.requireRow('SELECT * FROM offices WHERE id = ?', officeId, 'Office'), year, month);
  }

  listBudgets(year = new Date().getUTCFullYear(), month = new Date().getUTCMonth() + 1) {
    return this.all('SELECT * FROM offices ORDER BY id').map((office) => this.budgetFor(office, year, month));
  }

  setBudget(input: SetBudgetInput) {
    const office = this.requireRow('SELECT * FROM offices WHERE id = ?', input.officeId, 'Office');
    if (input.month < 1 || input.month > 12) throw new HttpError(400, 'Month must be between 1 and 12');
    this.db.prepare(`INSERT INTO monthly_budgets (office_id, year, month, amount_minor, currency, budget_amount)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(office_id, year, month) DO UPDATE SET amount_minor = excluded.amount_minor,
      currency = excluded.currency, budget_amount = excluded.budget_amount, updated_at = datetime('now')`)
      .run(input.officeId, input.year, input.month, Math.round(input.budgetAmount * 100), office.currency, input.budgetAmount);
    return this.getBudget(input.officeId, input.year, input.month);
  }

  /** Must be called inside PurchaseService's immediate transaction. */
  reservePurchase(refillRequestId: number, office: Row, purchasedAt: Date, amount: number, currency: string): number {
    const year = purchasedAt.getUTCFullYear();
    const month = purchasedAt.getUTCMonth() + 1;
    const stored = this.one('SELECT budget_amount FROM monthly_budgets WHERE office_id = ? AND year = ? AND month = ?', office.id, year, month);
    const budgetAmount = stored ? Number(stored.budget_amount) : Number(office.monthly_budget) / 100;
    const spent = Number(this.one(`SELECT COALESCE(SUM(p.amount), 0) total FROM purchases p
      JOIN refill_requests rr ON rr.id = p.refill_request_id JOIN snack_counters sc ON sc.id = rr.snack_counter_id
      WHERE sc.office_id = ? AND strftime('%Y', p.purchased_at) = ? AND strftime('%m', p.purchased_at) = ?`,
    office.id, String(year), String(month).padStart(2, '0'))?.total ?? 0);
    const reserved = Number(this.one("SELECT COALESCE(SUM(amount), 0) total FROM budget_reservations WHERE office_id = ? AND year = ? AND month = ? AND status = 'reserved'", office.id, year, month)?.total ?? 0);
    const cents = (value: number) => Math.round(value * 100);
    if (cents(spent) + cents(reserved) + cents(amount) > cents(budgetAmount)) {
      const policyMessage = env.OVER_BUDGET_POLICY === 'approval_required'
        ? ' This purchase requires management approval; an approval override is not configured.' : '';
      throw new HttpError(409, `Purchase exceeds the ${String(office.currency)} monthly budget. Available: ${Math.max(0, budgetAmount - spent - reserved).toFixed(2)} ${String(office.currency)}.${policyMessage}`);
    }
    const result = this.db.prepare(`INSERT INTO budget_reservations (refill_request_id, office_id, year, month, amount, currency)
      VALUES (?, ?, ?, ?, ?, ?)`).run(refillRequestId, office.id, year, month, amount, currency);
    return Number(result.lastInsertRowid);
  }
}
