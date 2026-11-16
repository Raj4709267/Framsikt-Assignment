import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createRuntime } from '../../src/app.js';
import { openDatabase } from '../../src/database/connection.js';
import { migrateDatabase } from '../../src/database/migrate.js';
import { seedDatabase } from '../../src/database/seed.js';
import { SnackService } from '../../src/modules/snack.service.js';
import { MockHrService } from '../../src/integrations/hr/hr.mock.js';
import { runAssignmentExpiryJob } from '../../src/jobs/assignment-expiry.job.js';
describe('refill workflow', () => {
  let directory: string;
  let database: Database.Database;
  let runtime: ReturnType<typeof createRuntime>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'snack-counter-integration-'));
    database = openDatabase(join(directory, 'test.db'));
    migrateDatabase(database);
    seedDatabase(database);
    runtime = createRuntime({ database });
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports, assigns, accepts, purchases, submits a claim, and tracks approval and payment', async () => {
    const employee = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    const created = await request(runtime.app).post('/api/refills').send({ snackCounterId: counter.id, reportedByEmployeeId: employee.id, description: 'Biscuits are empty' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('assigned');
    expect(created.body.data.assignments).toHaveLength(1);
    const refillId = created.body.data.id as number;
    const fetched = await request(runtime.app).get(`/api/refills/${refillId}`);
    expect(fetched.body.data.office_name).toBe('Oslo');
    expect(fetched.body.data.snack_counter_id).toBe(counter.id);
    expect((await request(runtime.app).post('/api/refills').send({ snackCounterId: counter.id, reportedByEmployeeId: employee.id, description: 'Duplicate' })).status).toBe(409);
    const volunteerId = created.body.data.assignments[0].volunteer_employee_id as number;

    expect((await request(runtime.app).post(`/api/refills/${refillId}/purchase`).field('employeeId', String(volunteerId))).status).toBe(400);
    expect((await request(runtime.app).post(`/api/refills/${refillId}/accept`).send({ employeeId: volunteerId })).status).toBe(200);
    const purchaseRequest = () => request(runtime.app).post(`/api/refills/${refillId}/purchase`)
      .field('employeeId', String(volunteerId)).field('amount', '125.50').field('currency', 'NOK')
      .field('description', 'Snacks for kitchen').attach('receipt', Buffer.from('89504e470d0a1a0a', 'hex'), { filename: 'receipt.png', contentType: 'image/png' });
    const purchaseResults = await Promise.all([purchaseRequest(), purchaseRequest()]);
    expect(purchaseResults.map((result) => result.status).sort()).toEqual([201, 409]);
    const purchased = purchaseResults.find((result) => result.status === 201)!;
    expect(purchased.status).toBe(201);
    expect(purchased.body.data.reimbursement.status).toBe('submitted');
    const claimId = purchased.body.data.reimbursement.hr_claim_id as string;
    expect(purchased.body.data.reimbursement.status).not.toBe('approved');
    const mockClaim = (runtime.hr as MockHrService).claims.get(claimId)!;
    expect(mockClaim.input).toMatchObject({ employeeId: volunteerId, amount: 125.5, currency: 'NOK', description: 'Snacks for kitchen' });
    expect(mockClaim.input.receiptPath).toMatch(/^uploads\/receipts\//);

    expect((await request(runtime.app).post(`/api/mock-hr/claims/${claimId}/approve`).send({})).body.data.status).toBe('approved');
    expect((await request(runtime.app).post(`/api/mock-hr/claims/${claimId}/mark-paid`).send({})).body.data.status).toBe('reimbursed');
    expect((await request(runtime.app).post(`/api/refills/${refillId}/complete`).send({ employeeId: volunteerId })).status).toBe(200);
    expect((await request(runtime.app).post(`/api/refills/${refillId}/accept`).send({ employeeId: volunteerId })).status).toBe(409);
    expect((await request(runtime.app).post(`/api/refills/${refillId}/complete`).send({ employeeId: volunteerId })).status).toBe(409);
    expect(runtime.service.runAssignmentExpiryJob(new Date('2030-01-01T00:00:00.000Z')).processed).toBe(0);
    expect(database.prepare('SELECT COUNT(*) count FROM purchases WHERE refill_request_id = ?').get(refillId)).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) count FROM reimbursements').get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) count FROM budget_reservations WHERE status = 'converted'").get()).toEqual({ count: 1 });
  });

  it('allows only one acceptance and preserves old assignments when declined or expired', async () => {
    const reporter = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    const secondEligible = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.2@example.test'").get() as { id: number };
    const thirdEligible = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.3@example.test'").get() as { id: number };
    runtime.service.updateAvailability(secondEligible.id, { status: 'available' });
    runtime.service.updateAvailability(thirdEligible.id, { status: 'available' });
    const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: reporter.id, description: 'Empty' });
    const assignment = task.assignments[0] as { volunteer_employee_id: number };
    const results = await Promise.all([
      request(runtime.app).post(`/api/refills/${task.id}/accept`).send({ employeeId: assignment.volunteer_employee_id }),
      request(runtime.app).post(`/api/refills/${task.id}/accept`).send({ employeeId: secondEligible.id }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(database.prepare("SELECT COUNT(*) count FROM assignments WHERE refill_request_id = ? AND status IN ('offered','accepted')").get(task.id)).toEqual({ count: 1 });
    expect((await request(runtime.app).post(`/api/refills/${task.id}/accept`).send({ employeeId: assignment.volunteer_employee_id })).status).toBe(409);

    runtime.service.declineRefill(task.id as number, assignment.volunteer_employee_id);
    let history = runtime.service.getRefill(task.id as number).assignments as Array<{ status: string; volunteer_employee_id: number }>;
    expect(history.map((entry) => entry.status)).toContain('declined');

    const active = history.find((entry) => entry.status === 'offered');
    runtime.service.updateAvailability(secondEligible.id, { status: 'on_leave' });
    if (active) database.prepare("UPDATE assignments SET expires_at = '2000-01-01T00:00:00.000Z' WHERE status = 'offered' AND refill_request_id = ?").run(task.id);
    runAssignmentExpiryJob(runtime.service, new Date('2001-01-01T00:00:00.000Z'));
    history = runtime.service.getRefill(task.id as number).assignments as Array<{ status: string; volunteer_employee_id: number }>;
    expect(history.map((entry) => entry.status)).toContain('expired');
    expect(history.filter((entry) => ['offered', 'accepted'].includes(entry.status))).toHaveLength(1);
    expect(history.find((entry) => entry.status === 'offered')?.volunteer_employee_id).toBe(thirdEligible.id);
    expect(runtime.service.runAssignmentExpiryJob(new Date('2001-01-01T00:00:00.000Z')).processed).toBe(0);
  });

  it('keeps a refill open if all volunteers are unavailable and enforces the office budget', async () => {
    database.prepare("UPDATE volunteer_availability SET availability_status = 'on_leave' WHERE office_id = (SELECT id FROM offices WHERE name = 'Oslo')").run();
    const reporter = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: reporter.id, description: 'Empty' });
    expect(task.status).toBe('open');
    expect(task.assignments).toHaveLength(0);

    runtime.service.updateAvailability(reporter.id, { status: 'available' });
    runtime.service.runAssignmentExpiryJob();
    const retried = runtime.service.getRefill(task.id as number);
    const volunteerId = (retried.assignments as Array<{ volunteer_employee_id: number }>)[0].volunteer_employee_id;
    runtime.service.acceptRefill(task.id as number, volunteerId);
    await expect(runtime.service.purchaseRefill(task.id as number, volunteerId, {
      amount: 6001, currency: 'NOK', description: 'Over budget', receiptPath: 'receipt.png',
    })).rejects.toThrow(/exceeds the NOK monthly budget/);
    expect(database.prepare('SELECT COUNT(*) count FROM purchases').get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) count FROM budget_reservations WHERE status = 'reserved'").get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) count FROM reimbursements').get()).toEqual({ count: 0 });
    expect((runtime.hr as MockHrService).claims.size).toBe(0);
    expect(() => runtime.service.completeRefill(task.id as number, volunteerId)).toThrow(/purchase before completing/);
  });

  it('keeps report totals separate by currency', () => {
    const report = runtime.service.monthlyReport(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1);
    expect(report.combined.convertedToSingleCurrency).toBe(false);
    expect(Object.keys(report.combined.currencyTotals).sort()).toEqual(['INR', 'NOK']);
  });

  it('rechecks volunteer availability when accepting an offered assignment', async () => {
    const reporter = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: reporter.id, description: 'Availability check' });
    const volunteerId = (task.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    runtime.service.updateAvailability(volunteerId, { status: 'on_leave' });
    const rejected = await request(runtime.app).post(`/api/refills/${task.id}/accept`).send({ employeeId: volunteerId });
    expect(rejected.status).toBe(409);
    expect(rejected.body.message).toMatch(/no longer eligible and available/);
    runtime.service.updateAvailability(volunteerId, { status: 'available' });
    expect((await request(runtime.app).post(`/api/refills/${task.id}/accept`).send({ employeeId: volunteerId })).status).toBe(200);
  });

  it('reassigns a refill when an accepted volunteer misses the completion deadline', () => {
    const reporter = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const nextVolunteer = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.2@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    runtime.service.updateAvailability(nextVolunteer.id, { status: 'available' });

    const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: reporter.id, description: 'Accepted task left incomplete' });
    const firstVolunteer = (task.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    runtime.service.acceptRefill(task.id as number, firstVolunteer);
    runtime.service.updateAvailability(firstVolunteer, { status: 'on_leave' });
    database.prepare("UPDATE assignments SET expires_at = '2000-01-01T00:00:00.000Z' WHERE refill_request_id = ? AND status = 'accepted'").run(task.id);

    expect(runAssignmentExpiryJob(runtime.service, new Date('2001-01-01T00:00:00.000Z')).processed).toBe(1);
    const reassigned = runtime.service.getRefill(task.id as number);
    expect(reassigned.status).toBe('assigned');
    const history = reassigned.assignments as Array<{ status: string; volunteer_employee_id: number }>;
    expect(history.map(({ status }) => status)).toEqual(['expired', 'offered']);
    expect(history[1].volunteer_employee_id).toBe(nextVolunteer.id);
    expect(runAssignmentExpiryJob(runtime.service, new Date('2001-01-01T00:00:00.000Z')).processed).toBe(0);
  });

  it('validates missing resources, malformed payloads, invalid amounts, and foreign keys', async () => {
    expect((await request(runtime.app).get('/api/refills/99999')).status).toBe(404);
    expect((await request(runtime.app).post('/api/refills').send({ snackCounterId: 'bad' })).status).toBe(400);
    expect((await request(runtime.app).post('/api/employees').send({ name: 'Nobody', email: 'nobody@example.test', officeId: 999 })).status).toBe(404);
    expect(() => database.prepare(`INSERT INTO monthly_budgets (office_id, year, month, amount_minor, currency, budget_amount)
      VALUES (999, 2026, 11, 100, 'NOK', 1)`).run()).toThrow(/FOREIGN KEY constraint failed/);

    const reporter = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: reporter.id, description: 'Amount check' });
    const volunteerId = (task.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    runtime.service.acceptRefill(task.id as number, volunteerId);
    for (const amount of ['0', '-1']) {
      const invalid = await request(runtime.app).post(`/api/refills/${task.id}/purchase`)
        .field('employeeId', String(volunteerId)).field('amount', amount).field('currency', 'NOK').field('description', 'Invalid amount')
        .attach('receipt', Buffer.from('89504e470d0a1a0a', 'hex'), { filename: 'receipt.png', contentType: 'image/png' });
      expect(invalid.status).toBe(400);
    }
    expect(database.prepare('SELECT COUNT(*) count FROM purchases').get()).toEqual({ count: 0 });
  });

  it('calculates monthly totals independently for NOK and INR and excludes the prior month', async () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    for (const officeName of ['Oslo', 'Bengaluru']) {
      const visitor = database.prepare('SELECT id FROM employees WHERE office_id = (SELECT id FROM offices WHERE name = ?) AND email LIKE ? ORDER BY id LIMIT 1')
        .get(officeName, `snack.${officeName.toLowerCase()}.2@%`) as { id: number };
      runtime.service.updateAvailability(visitor.id, { status: 'available' });
    }
    const osloDate = new Date(Date.UTC(year, month - 1, 15, 12)).toISOString();
    const bengaluruDate = osloDate;
    const previousDate = new Date(Date.UTC(year, month - 2, 15, 12)).toISOString();
    const createPurchase = async (officeName: 'Oslo' | 'Bengaluru', amount: number, purchasedAt: string) => {
      const counter = database.prepare('SELECT sc.id FROM snack_counters sc JOIN offices o ON o.id = sc.office_id WHERE o.name = ? ORDER BY sc.id LIMIT 1').get(officeName) as { id: number };
      const reporter = database.prepare('SELECT id FROM employees WHERE office_id = (SELECT id FROM offices WHERE name = ?) ORDER BY id LIMIT 1').get(officeName) as { id: number };
      const currency = officeName === 'Oslo' ? 'NOK' : 'INR';
      const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: reporter.id, description: 'Monthly report fixture' });
      const volunteerId = (task.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
      runtime.service.acceptRefill(task.id as number, volunteerId);
      const result = await runtime.service.purchaseRefill(task.id as number, volunteerId, { amount, currency, description: `${officeName} snacks`, receiptPath: 'fixture/receipt.png', purchasedAt });
      runtime.service.completeRefill(task.id as number, volunteerId);
      return result.reimbursement;
    };

    const osloPending = await createPurchase('Oslo', 1000, osloDate);
    const osloApproved = await createPurchase('Oslo', 1500, osloDate);
    const bengaluruApproved = await createPurchase('Bengaluru', 3000, bengaluruDate);
    const bengaluruPending = await createPurchase('Bengaluru', 2000, bengaluruDate);
    await createPurchase('Oslo', 400, previousDate);
    await runtime.service.updateMockHrClaim(String(osloApproved.hr_claim_id), 'approved');
    await runtime.service.updateMockHrClaim(String(bengaluruApproved.hr_claim_id), 'approved');
    await runtime.service.updateMockHrClaim(String(bengaluruApproved.hr_claim_id), 'reimbursed');

    const report = runtime.service.monthlyReport(year, month);
    const oslo = report.offices.find((office) => office.officeName === 'Oslo')!;
    const bengaluru = report.offices.find((office) => office.officeName === 'Bengaluru')!;
    expect(oslo).toMatchObject({ currency: 'NOK', monthlyBudget: 6000, actualPurchaseSpending: 2500, remainingBudget: 3500, numberOfPurchases: 2, pendingReimbursementAmounts: 1000, approvedSpending: 1500 });
    expect(bengaluru).toMatchObject({ currency: 'INR', monthlyBudget: 15000, actualPurchaseSpending: 5000, remainingBudget: 10000, numberOfPurchases: 2, pendingReimbursementAmounts: 2000, paidReimbursements: 3000 });
    expect(report.combined.convertedToSingleCurrency).toBe(false);
    expect(report.combined.currencyTotals).toMatchObject({ NOK: { actualPurchaseSpending: 2500 }, INR: { actualPurchaseSpending: 5000 } });
    expect(osloPending.status).toBe('submitted');
    expect(bengaluruPending.status).toBe('submitted');

    const emptyReport = runtime.service.monthlyReport(year + 1, 1);
    expect(emptyReport.offices.every((office) => office.actualPurchaseSpending === 0 && office.numberOfPurchases === 0)).toBe(true);
  });

  it('only selects cross-office volunteers during an explicit temporary eligibility window', async () => {
    const visitor = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.2@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Bengaluru Kitchen'").get() as { id: number };
    const office = database.prepare("SELECT id FROM offices WHERE name = 'Bengaluru'").get() as { id: number };
    database.prepare("UPDATE volunteer_availability SET availability_status = 'on_leave' WHERE office_id = (SELECT id FROM offices WHERE name = 'Bengaluru')").run();
    expect(() => runtime.service.updateAvailability(visitor.id, { officeId: office.id, status: 'available' })).toThrow(/explicitly enabled/);
    const starts = new Date(Date.now() - 60_000).toISOString();
    const ends = new Date(Date.now() + 86_400_000).toISOString();
    runtime.service.updateAvailability(visitor.id, { officeId: office.id, status: 'available', availableFrom: starts, availableUntil: ends, temporaryEligibility: true });
    const reporter = database.prepare("SELECT id FROM employees WHERE email = 'snack.bengaluru.1@example.test'").get() as { id: number };
    const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: reporter.id, description: 'Empty in Bengaluru' });
    expect((task.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id).toBe(visitor.id);
    database.prepare('DELETE FROM volunteer_office_eligibility WHERE employee_id = ? AND office_id = ?').run(visitor.id, office.id);
    const response = await request(runtime.app).post(`/api/refills/${task.id}/accept`).send({ employeeId: visitor.id });
    expect(response.status).toBe(409);
  });

  it('prioritizes home-office volunteers when temporary visitors are also eligible', () => {
    const visitor = database.prepare("SELECT id FROM employees WHERE email = 'snack.bengaluru.2@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    const oslo = database.prepare("SELECT id FROM offices WHERE name = 'Oslo'").get() as { id: number };
    const homeVolunteer = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    runtime.service.updateAvailability(visitor.id, { officeId: oslo.id, status: 'available', availableFrom: new Date(Date.now() - 60_000).toISOString(), availableUntil: new Date(Date.now() + 86_400_000).toISOString(), temporaryEligibility: true });
    const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: homeVolunteer.id, description: 'Home office priority' });
    expect((task.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id).toBe(homeVolunteer.id);
  });

  it('assigns two different refill requests independently to different available volunteers', async () => {
    const reporter = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const counters = database.prepare("SELECT id FROM snack_counters WHERE office_id = (SELECT id FROM offices WHERE name = 'Oslo') ORDER BY id").all() as Array<{ id: number }>;
    const secondVolunteer = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.2@example.test'").get() as { id: number };
    runtime.service.updateAvailability(secondVolunteer.id, { status: 'available' });
    const first = runtime.service.createRefill({ snackCounterId: counters[0].id, reportedByEmployeeId: reporter.id, description: 'Task one' });
    const second = runtime.service.createRefill({ snackCounterId: counters[1].id, reportedByEmployeeId: reporter.id, description: 'Task two' });
    const firstAssignee = (first.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    const secondAssignee = (second.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    expect(firstAssignee).not.toBe(secondAssignee);
    expect(database.prepare("SELECT COUNT(*) count FROM assignments WHERE status IN ('offered','accepted')").get()).toEqual({ count: 2 });
    const accepts = await Promise.all([
      request(runtime.app).post(`/api/refills/${first.id}/accept`).send({ employeeId: firstAssignee }),
      request(runtime.app).post(`/api/refills/${second.id}/accept`).send({ employeeId: secondAssignee }),
    ]);
    expect(accepts.map((response) => response.status)).toEqual([200, 200]);
  });

  it('serializes concurrent purchases from different refills at the monthly budget limit', async () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const oslo = database.prepare("SELECT id FROM offices WHERE name = 'Oslo'").get() as { id: number };
    runtime.service.setBudget({ officeId: oslo.id, year, month, budgetAmount: 100 });
    const reporter = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const secondVolunteer = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.2@example.test'").get() as { id: number };
    runtime.service.updateAvailability(secondVolunteer.id, { status: 'available' });
    const counters = database.prepare("SELECT id FROM snack_counters WHERE office_id = ? ORDER BY id").all(oslo.id) as Array<{ id: number }>;
    const first = runtime.service.createRefill({ snackCounterId: counters[0].id, reportedByEmployeeId: reporter.id, description: 'Concurrent purchase A' });
    const second = runtime.service.createRefill({ snackCounterId: counters[1].id, reportedByEmployeeId: reporter.id, description: 'Concurrent purchase B' });
    const firstVolunteer = (first.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    const secondAssignee = (second.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    expect(secondAssignee).not.toBe(firstVolunteer);
    runtime.service.acceptRefill(first.id as number, firstVolunteer);
    runtime.service.acceptRefill(second.id as number, secondAssignee);

    const purchases = await Promise.allSettled([
      runtime.service.purchaseRefill(first.id as number, firstVolunteer, { amount: 60, currency: 'NOK', description: 'Purchase A', receiptPath: 'receipt-a.png' }),
      runtime.service.purchaseRefill(second.id as number, secondAssignee, { amount: 60, currency: 'NOK', description: 'Purchase B', receiptPath: 'receipt-b.png' }),
    ]);
    expect(purchases.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(purchases.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(database.prepare('SELECT COUNT(*) count FROM purchases').get()).toEqual({ count: 1 });
    expect(runtime.service.getBudget(oslo.id, year, month)).toMatchObject({ actualPurchaseSpending: 60, remainingBudget: 40 });
  });

  it('persists seeded and changed data across separate SQLite connections', () => {
    const employee = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const secondConnection = openDatabase(join(directory, 'test.db'));
    try {
      expect(secondConnection.prepare('SELECT email FROM employees WHERE id = ?').get(employee.id)).toEqual({ email: 'snack.oslo.1@example.test' });
      expect(secondConnection.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      secondConnection.close();
    }
  });

  it('returns office budgets and allows a period budget override through the API', async () => {
    const response = await request(runtime.app).get('/api/budgets');
    expect(response.status).toBe(200);
    expect(response.body.data.map((budget: { currency: string; monthlyBudget: number }) => [budget.currency, budget.monthlyBudget]))
      .toEqual([['NOK', 6000], ['INR', 15000]]);
    const oslo = database.prepare("SELECT id FROM offices WHERE name = 'Oslo'").get() as { id: number };
    const updated = await request(runtime.app).post('/api/budgets').send({ officeId: oslo.id, year: 2026, month: 11, budgetAmount: 7000 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.monthlyBudget).toBe(7000);
    expect((await request(runtime.app).get(`/api/budgets/${oslo.id}/2026/11`)).body.data.monthlyBudget).toBe(7000);
  });

  it('preserves HR rejection details and keeps rejection separate from payment', async () => {
    const employee = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    const task = runtime.service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: employee.id, description: 'Rejected receipt test' });
    const volunteerId = (task.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    runtime.service.acceptRefill(task.id as number, volunteerId);
    const result = await runtime.service.purchaseRefill(task.id as number, volunteerId, { amount: 35, currency: 'NOK', description: 'Snacks', receiptPath: 'receipt.png' });
    const claimId = String(result.reimbursement.hr_claim_id);
    const rejected = await request(runtime.app).post(`/api/mock-hr/claims/${claimId}/reject`).send({ reason: 'Receipt is unreadable' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({ status: 'rejected', rejection_reason: 'Receipt is unreadable' });
    expect(rejected.body.data.paid_at).toBeNull();
    expect((await request(runtime.app).post(`/api/mock-hr/claims/${claimId}/mark-paid`).send({})).status).toBe(409);
  });

  it('retries failed HR submission idempotently without duplicating the purchase or claim', async () => {
    const claims = new Map<string, { claimId: string; status: 'submitted' }>();
    let calls = 0;
    const flakyHr = {
      async submitClaim(input: { idempotencyKey: string }) {
        calls += 1;
        const claim = claims.get(input.idempotencyKey) ?? { claimId: 'MOCK-RETRY-1', status: 'submitted' as const };
        claims.set(input.idempotencyKey, claim);
        if (calls === 1) throw new Error('temporary mock HR failure');
        return claim;
      },
      async updateClaim(claimId: string, status: 'approved' | 'rejected' | 'reimbursed') { return { claimId, status }; },
    };
    const service = new SnackService(database, runtime.chat, flakyHr);
    const employee = database.prepare("SELECT id FROM employees WHERE email = 'snack.oslo.1@example.test'").get() as { id: number };
    const counter = database.prepare("SELECT id FROM snack_counters WHERE name = 'Oslo Kitchen'").get() as { id: number };
    const task = service.createRefill({ snackCounterId: counter.id, reportedByEmployeeId: employee.id, description: 'Retry HR submission' });
    const volunteerId = (task.assignments[0] as { volunteer_employee_id: number }).volunteer_employee_id;
    service.acceptRefill(task.id as number, volunteerId);
    const submitted = await service.purchaseRefill(task.id as number, volunteerId, { amount: 20, currency: 'NOK', description: 'Test purchase', receiptPath: 'test/receipt.png' });
    expect(submitted.reimbursement.status).toBe('submission_failed');
    expect((await service.retryClaim(Number(submitted.reimbursement.id))).status).toBe('submitted');
    expect(database.prepare('SELECT COUNT(*) count FROM purchases').get()).toEqual({ count: 1 });
    expect(database.prepare('SELECT COUNT(*) count FROM reimbursements').get()).toEqual({ count: 1 });
    expect(claims.size).toBe(1);
    expect(calls).toBe(2);
  });
});
