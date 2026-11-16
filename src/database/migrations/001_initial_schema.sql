CREATE TABLE offices (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (name IN ('Oslo', 'Bengaluru')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE volunteer_availability (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  available_from TEXT NOT NULL,
  available_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE refill_requests (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  requested_by_employee_id INTEGER REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  refill_request_id INTEGER NOT NULL REFERENCES refill_requests(id) ON DELETE CASCADE,
  volunteer_employee_id INTEGER NOT NULL REFERENCES employees(id),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  refill_request_id INTEGER REFERENCES refill_requests(id),
  purchased_by_employee_id INTEGER REFERENCES employees(id),
  amount_minor INTEGER,
  currency TEXT,
  receipt_path TEXT,
  purchased_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reimbursements (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  status TEXT NOT NULL DEFAULT 'pending',
  external_claim_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE monthly_budgets (
  id INTEGER PRIMARY KEY,
  office_id INTEGER NOT NULL REFERENCES offices(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (office_id, year, month)
);

CREATE INDEX idx_employees_office_id ON employees(office_id);
CREATE INDEX idx_volunteer_availability_employee_id ON volunteer_availability(employee_id);
CREATE INDEX idx_refill_requests_office_status ON refill_requests(office_id, status);
CREATE INDEX idx_assignments_request_id ON assignments(refill_request_id);
CREATE INDEX idx_purchases_request_id ON purchases(refill_request_id);
CREATE INDEX idx_reimbursements_status ON reimbursements(status);
CREATE INDEX idx_monthly_budgets_office_period ON monthly_budgets(office_id, year, month);
