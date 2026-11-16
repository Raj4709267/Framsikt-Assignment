export interface HrClaimInput {
  employeeId: number;
  amount: number;
  currency: string;
  description: string;
  receiptPath: string;
  idempotencyKey: string;
}

export interface HrClaim {
  claimId: string;
  status: 'submitted' | 'approved' | 'rejected' | 'reimbursed';
  rejectionReason?: string;
}

export interface HrService {
  submitClaim(input: HrClaimInput): Promise<HrClaim>;
  updateClaim(claimId: string, status: 'approved' | 'rejected' | 'reimbursed', reason?: string): Promise<HrClaim>;
}
