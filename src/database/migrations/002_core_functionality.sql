ALTER TABLE offices ADD COLUMN currency TEXT NOT NULL DEFAULT 'NOK';
ALTER TABLE offices ADD COLUMN monthly_budget INTEGER NOT NULL DEFAULT 600000;
ALTER TABLE employees ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE volunteer_availability ADD COLUMN office_id INTEGER REFERENCES offices(id);
ALTER TABLE volunteer_availability ADD COLUMN is_volunteer INTEGER NOT NULL DEFAULT 1 CHECK (is_volunteer IN (0, 1));
ALTER TABLE volunteer_availability ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'available'
  CHECK (availability_status IN ('available', 'unavailable', 'on_leave'));

CREATE TABLE snack_counters (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (office_id, name)
);

ALTER TABLE refill_requests ADD COLUMN snack_counter_id INTEGER REFERENCES snack_counters(id);
ALTER TABLE refill_requests ADD COLUMN reported_by_employee_id INTEGER REFERENCES employees(id);
ALTER TABLE refill_requests ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE refill_requests ADD COLUMN completed_at TEXT;
UPDATE refill_requests SET status = CASE status
  WHEN 'pending' THEN 'open' WHEN 'in_progress' THEN 'assigned' ELSE status END;

ALTER TABLE assignments ADD COLUMN status TEXT NOT NULL DEFAULT 'offered';
ALTER TABLE assignments ADD COLUMN assigned_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE assignments ADD COLUMN accepted_at TEXT;
ALTER TABLE assignments ADD COLUMN completed_at TEXT;
ALTER TABLE assignments ADD COLUMN reassignment_reason TEXT;
UPDATE assignments SET status = CASE WHEN expires_at IS NOT NULL THEN 'offered' ELSE 'accepted' END;

ALTER TABLE purchases ADD COLUMN volunteer_employee_id INTEGER REFERENCES employees(id);
ALTER TABLE purchases ADD COLUMN amount REAL;
ALTER TABLE purchases ADD COLUMN description TEXT NOT NULL DEFAULT '';
UPDATE purchases SET volunteer_employee_id = purchased_by_employee_id,
  amount = COALESCE(amount_minor, 0) / 100.0, currency = COALESCE(currency, 'NOK');

ALTER TABLE reimbursements ADD COLUMN amount REAL NOT NULL DEFAULT 0;
ALTER TABLE reimbursements ADD COLUMN currency TEXT NOT NULL DEFAULT 'NOK';
ALTER TABLE reimbursements ADD COLUMN submitted_at TEXT;
ALTER TABLE reimbursements ADD COLUMN approved_at TEXT;
ALTER TABLE reimbursements ADD COLUMN rejected_at TEXT;
ALTER TABLE reimbursements ADD COLUMN paid_at TEXT;
ALTER TABLE reimbursements ADD COLUMN rejection_reason TEXT;
UPDATE reimbursements SET amount = COALESCE((SELECT amount FROM purchases WHERE purchases.id = reimbursements.purchase_id), 0),
  currency = COALESCE((SELECT currency FROM purchases WHERE purchases.id = reimbursements.purchase_id), 'NOK');

CREATE TABLE volunteer_office_eligibility (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  available_from TEXT,
  available_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, office_id, available_from)
);

CREATE TABLE budget_reservations (
  id INTEGER PRIMARY KEY,
  refill_request_id INTEGER NOT NULL UNIQUE REFERENCES refill_requests(id) ON DELETE CASCADE,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'released', 'converted')) DEFAULT 'reserved',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE monthly_budgets ADD COLUMN budget_amount REAL NOT NULL DEFAULT 0;
UPDATE monthly_budgets SET budget_amount = amount_minor / 100.0;
CREATE UNIQUE INDEX idx_refills_one_active_per_counter ON refill_requests(snack_counter_id)
  WHERE snack_counter_id IS NOT NULL AND status IN ('open', 'assigned', 'accepted', 'purchased');

CREATE UNIQUE INDEX idx_assignments_one_active_per_refill ON assignments(refill_request_id)
  WHERE status IN ('offered', 'accepted');
CREATE UNIQUE INDEX idx_purchases_one_per_refill ON purchases(refill_request_id) WHERE refill_request_id IS NOT NULL;
CREATE INDEX idx_volunteer_eligibility_office ON volunteer_office_eligibility(office_id, employee_id);
CREATE INDEX idx_assignments_expiry ON assignments(status, expires_at);
CREATE INDEX idx_purchases_purchased_at ON purchases(purchased_at);
CREATE INDEX idx_refills_counter_status ON refill_requests(snack_counter_id, status);
CREATE INDEX idx_reimbursements_purchase_id ON reimbursements(purchase_id);
CREATE UNIQUE INDEX idx_reimbursements_one_per_purchase ON reimbursements(purchase_id);
CREATE UNIQUE INDEX idx_volunteer_availability_employee_office ON volunteer_availability(employee_id, office_id)
  WHERE office_id IS NOT NULL;
