ALTER TABLE reimbursements ADD COLUMN hr_claim_id TEXT;
CREATE UNIQUE INDEX idx_reimbursements_hr_claim_id ON reimbursements(hr_claim_id) WHERE hr_claim_id IS NOT NULL;
