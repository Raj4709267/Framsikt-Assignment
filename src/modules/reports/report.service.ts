import type Database from 'better-sqlite3';
import { BaseService, type Row } from '../base.service.js';
import { BudgetService } from '../budgets/budget.service.js';

export class ReportService extends BaseService {
  constructor(db: Database.Database, private readonly budgets: BudgetService) { super(db); }

  monthlyReport(year: number, month: number) {
    const offices = this.all('SELECT * FROM offices ORDER BY id').map((office) => {
      const budget = this.budgets.getBudget(Number(office.id), year, month);
      const totals = this.one(`SELECT COUNT(DISTINCT p.id) purchases,
        COUNT(DISTINCT CASE WHEN rr.status = 'completed' THEN rr.id END) completed_refills,
        COUNT(DISTINCT r.id) reimbursements,
        SUM(CASE WHEN r.status = 'submitted' THEN r.amount ELSE 0 END) submitted_reimbursements,
        SUM(CASE WHEN r.status = 'approved' THEN r.amount ELSE 0 END) approved_reimbursements,
        SUM(CASE WHEN r.status = 'reimbursed' THEN r.amount ELSE 0 END) paid_reimbursements
        FROM snack_counters sc LEFT JOIN refill_requests rr ON rr.snack_counter_id = sc.id
        LEFT JOIN purchases p ON p.refill_request_id = rr.id AND strftime('%Y', p.purchased_at) = ? AND strftime('%m', p.purchased_at) = ?
        LEFT JOIN reimbursements r ON r.purchase_id = p.id WHERE sc.office_id = ?`,
      String(year), String(month).padStart(2, '0'), office.id) ?? {} as Row;
      const byCounter = this.all(`SELECT sc.id snackCounterId, sc.name snackCounter, COUNT(p.id) purchases,
        COALESCE(SUM(p.amount),0) actualPurchaseSpending FROM snack_counters sc
        LEFT JOIN refill_requests rr ON rr.snack_counter_id = sc.id
        LEFT JOIN purchases p ON p.refill_request_id = rr.id AND strftime('%Y', p.purchased_at) = ? AND strftime('%m', p.purchased_at) = ?
        WHERE sc.office_id = ? GROUP BY sc.id ORDER BY sc.name`, String(year), String(month).padStart(2, '0'), office.id);
      return { ...budget, numberOfPurchases: Number(totals.purchases ?? 0), completedRefills: Number(totals.completed_refills ?? 0),
        numberOfReimbursements: Number(totals.reimbursements ?? 0), submittedReimbursements: Number(totals.submitted_reimbursements ?? 0),
        approvedReimbursements: Number(totals.approved_reimbursements ?? 0), paidReimbursements: Number(totals.paid_reimbursements ?? 0), snackCounters: byCounter };
    });
    const currencyTotals = Object.fromEntries([...new Set(offices.map((office) => String(office.currency)))].map((currency) => [currency,
      { actualPurchaseSpending: offices.filter((office) => office.currency === currency).reduce((total, office) => total + office.actualPurchaseSpending, 0),
        approvedSpending: offices.filter((office) => office.currency === currency).reduce((total, office) => total + office.approvedSpending, 0),
        pendingReimbursementAmounts: offices.filter((office) => office.currency === currency).reduce((total, office) => total + office.pendingReimbursementAmounts, 0) }]));
    return { year, month, offices, combined: { currencyTotals, convertedToSingleCurrency: false,
      note: 'Office totals are kept in their local currencies; no currency conversion is configured.' } };
  }
}
