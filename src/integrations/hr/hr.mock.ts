import { randomUUID } from 'node:crypto';
import type { HrClaim, HrClaimInput, HrService } from './hr.interface.js';
import { HttpError } from '../../shared/errors/http-error.js';

export class MockHrService implements HrService {
  readonly claims = new Map<string, HrClaim & { input: HrClaimInput }>();
  private readonly idempotency = new Map<string, string>();

  async submitClaim(input: HrClaimInput): Promise<HrClaim> {
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId) return this.claims.get(existingId)!;
    const claim: HrClaim & { input: HrClaimInput } = { claimId: `MOCK-${randomUUID()}`, status: 'submitted', input };
    this.claims.set(claim.claimId, claim);
    this.idempotency.set(input.idempotencyKey, claim.claimId);
    return claim;
  }

  async updateClaim(claimId: string, status: 'approved' | 'rejected' | 'reimbursed', reason?: string): Promise<HrClaim> {
    const claim = this.claims.get(claimId);
    if (!claim) throw new HttpError(404, 'Mock HR claim not found in this process');
    if (claim.status === 'rejected' || claim.status === 'reimbursed') throw new HttpError(409, `Claim is already ${claim.status}`);
    if (status === 'reimbursed' && claim.status !== 'approved') throw new HttpError(409, 'Only approved claims can be marked paid');
    const updated = { ...claim, status, ...(reason ? { rejectionReason: reason } : {}) };
    this.claims.set(claimId, updated);
    return updated;
  }
}
