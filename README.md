# Snack Counter Automation

A small TypeScript/Express API for reporting empty snack counters, assigning office volunteers, recording purchases and receipts, tracking simulated HR reimbursements, and reporting office budgets. The internal chat and HR systems are mocks; no external credentials or services are needed.

## Stack and architecture

Node.js, TypeScript, Express, SQLite via `better-sqlite3`, Zod, Pino, Multer, Vitest, Supertest, and tsx. `src/modules/api.routes.ts` remains the single REST route file. Business logic is split into the domain services in `employees/`, `offices/`, `volunteers/`, `refills/`, `purchases/`, `budgets/`, `reimbursements/`, and `reports/`. `snack.service.ts` only wires those services together for the existing routes. `src/database` owns versioned SQL migrations and seed data; `src/integrations` contains replaceable chat and HR interfaces and mocks; `src/jobs` contains the assignment expiry job. SQLite writes that affect workflow state run in transactions, with unique indexes as a second line of protection.

## Run locally

```sh
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Copy `.env.example` to `.env` to change defaults. `npm start` runs the compiled server; startup applies pending migrations. The API listens on `http://localhost:3000` by default. `GET /health` is a basic health check.

Useful commands:

- `npm run dev` — development server with reload
- `npm run build` — strict TypeScript build into `dist/`
- `npm start` — compiled server
- `npm test` / `npm run test:watch` — Vitest and Supertest
- `npm run db:migrate` — apply SQL migrations
- `npm run db:seed` — idempotently add sample offices, employees, counters, and volunteers

`DATABASE_PATH` defaults to `./data/snack-counter.db`; SQLite creates its parent directory automatically. `PORT`, `LOG_LEVEL`, `ASSIGNMENT_OFFER_TTL_HOURS` (24 by default), `ASSIGNMENT_COMPLETION_TTL_HOURS` (48), and `OVER_BUDGET_POLICY` (`block` or `approval_required`, default `block`) are also configurable. Both policies prevent silent overspending; `approval_required` returns an explicit management-approval-required error because no approval workflow is provided. Tests use isolated temporary SQLite files and a temporary receipt directory.

## API overview

JSON responses use `{ "success": true, "data": ..., "message": ... }`; errors use `{ "success": false, "message": ... }`.

- Employees: `POST/GET /api/employees`, `GET/PATCH /api/employees/:id`
- Offices: `GET /api/offices`, `GET /api/offices/:id`
- Snack counters: `GET/POST /api/snack-counters`, `GET/PATCH /api/snack-counters/:id`
- Volunteers: `POST /api/volunteers/opt-in`, `POST /api/volunteers/opt-out`, `PATCH /api/volunteers/:employeeId/availability`, `GET /api/volunteers`
- Refills: `POST/GET /api/refills`, `GET /api/refills/:id`, and `POST /api/refills/:id/{accept,decline,purchase,complete,cancel}`
- Budgets: `GET /api/budgets`, `GET /api/budgets/:officeId[/:year/:month]`, `POST /api/budgets`
- Reimbursements: `GET /api/reimbursements`, `GET /api/reimbursements/:id`, and `POST /api/reimbursements/:id/retry`
- Reports: `GET /api/reports/monthly?year=2026&month=11`
- Development/test mock HR: `POST /api/mock-hr/claims/:claimId/{approve,reject,mark-paid}` (disabled in production)

There is no authentication layer in this assignment boilerplate. Employee IDs are supplied to workflow endpoints and should be replaced with authenticated identity in a deployed company system.

### Example workflow

After seeding, create a refill for a known counter and employee:

```sh
curl -X POST http://localhost:3000/api/refills -H "Content-Type: application/json" -d "{\"snackCounterId\":1,\"reportedByEmployeeId\":1,\"description\":\"Biscuits are empty\"}"
```

The response includes the offered assignment and volunteer ID. Accept with `POST /api/refills/:id/accept` and body `{"employeeId": 1}`. Submit a purchase to `POST /api/refills/:id/purchase` as multipart form data containing `employeeId`, `amount`, `currency`, `description`, and an image field named `receipt`. Receipts accept JPEG, PNG, or WebP up to 5 MB. A successful purchase creates one reimbursement and submits it to mock HR. Use the returned `hr_claim_id` to call the mock approve endpoint, then mark-paid. The assigned volunteer can complete the refill after the purchase.

## Business rules and assumptions

- Volunteers are employees who opted in. They must be active, available, not already assigned an active task, and eligible for the counter's office. Home office eligibility is automatic; a temporary visit requires an explicit eligibility window.
- Selection is least-recently-assigned, with volunteers who have not yet been assigned preferred. A previously assigned person is avoided while another eligible candidate exists.
- Offered assignments expire after the configured offer TTL. Acceptance starts the configured completion deadline. A once-per-minute persistent timestamp job expires and reassigns overdue tasks; open tasks with no candidate are retried.
- Active refill requests are unique per counter. Only one active assignment per refill and one purchase per refill are allowed by database indexes and conditional transactional updates.
- Oslo has a 6,000 NOK monthly budget; Bengaluru has a 15,000 INR monthly budget. Budgets and spending stay separate by office currency. Purchases are rejected if the office's available monthly budget would be exceeded. The check and purchase insert happen in one SQLite transaction. Management override is deliberately not implemented; a future override should be explicit, audited, and authorized.
- Purchase records are the basis for spending; reimbursement pending, approved, and paid states are reported separately. HR approval and payment are distinct. The mock HR stores claim payloads in memory for the current process and uses a purchase idempotency key to avoid duplicate mock claims on retry.
- Chat notifications are captured by the mock adapter. No actual messages or reimbursements are sent.
- Purchase records show what was bought, not what was eaten. Consumption cannot be inferred without stock observations or an inventory tracking feature.

See the [two-page design overview](docs/snack_counter_automation_design.pdf) or its [editable Markdown source](docs/design.md) for the lifecycle, stored data, safeguards, and trade-offs.
