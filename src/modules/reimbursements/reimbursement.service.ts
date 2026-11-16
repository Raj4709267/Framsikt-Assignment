import type Database from 'better-sqlite3';
import { BaseService, type Row } from '../base.service.js';
import type { ChatService } from '../../integrations/chat/chat.interface.js';
import type { HrService } from '../../integrations/hr/hr.interface.js';
import { HttpError } from '../../shared/errors/http-error.js';

export class ReimbursementService extends BaseService {
  constructor(db: Database.Database, private readonly chat: ChatService, private readonly hr: HrService) { super(db); }

  listReimbursements(): Row[] {
    return this.all(`SELECT r.*, p.refill_request_id, p.description purchase_description
      FROM reimbursements r JOIN purchases p ON p.id = r.purchase_id ORDER BY r.created_at DESC`);
  }
  getReimbursement(id: number): Row { return this.requireRow('SELECT * FROM reimbursements WHERE id = ?', id, 'Reimbursement'); }

  async retryClaim(id: number): Promise<Row> {
    const reimbursement = this.getReimbursement(id);
    if (reimbursement.status !== 'submission_failed') throw new HttpError(409, 'Only failed submissions can be retried');
    const purchase = this.requireRow('SELECT * FROM purchases WHERE id = ?', Number(reimbursement.purchase_id), 'Purchase');
    const claim = await this.hr.submitClaim({ employeeId: Number(reimbursement.employee_id), amount: Number(purchase.amount),
      currency: String(purchase.currency), description: String(purchase.description), receiptPath: String(purchase.receipt_path),
      idempotencyKey: `purchase:${purchase.id}` });
    this.db.prepare("UPDATE reimbursements SET hr_claim_id = ?, status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'submission_failed'")
      .run(claim.claimId, id);
    return this.getReimbursement(id);
  }

  async updateMockHrClaim(claimId: string, status: 'approved' | 'rejected' | 'reimbursed', reason?: string): Promise<Row> {
    const reimbursement = this.one('SELECT * FROM reimbursements WHERE hr_claim_id = ?', claimId);
    if (!reimbursement) throw new HttpError(404, 'Reimbursement claim not found');
    const claim = await this.hr.updateClaim(claimId, status, reason);
    const timestamp = { approved: 'approved_at', rejected: 'rejected_at', reimbursed: 'paid_at' }[status];
    this.db.prepare(`UPDATE reimbursements SET status = ?, ${timestamp} = datetime('now'), rejection_reason = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, status === 'rejected' ? reason ?? 'Rejected by mock HR' : null, reimbursement.id);
    void this.chat.notifyEmployee(Number(reimbursement.employee_id), `HR claim ${claimId} is now ${status}${reason ? `: ${reason}` : ''}.`);
    return this.getReimbursement(Number(reimbursement.id));
  }
}
