import type Database from 'better-sqlite3';
import type { ChatService } from '../integrations/chat/chat.interface.js';
import type { HrService } from '../integrations/hr/hr.interface.js';
import type { Row } from './base.service.js';
import { BudgetService, type SetBudgetInput } from './budgets/budget.service.js';
import { EmployeeService, type CreateEmployeeInput, type UpdateEmployeeInput } from './employees/employee.service.js';
import { OfficeService, type CreateCounterInput, type UpdateCounterInput } from './offices/office.service.js';
import { PurchaseService, type PurchaseInput } from './purchases/purchase.service.js';
import { RefillService, type CreateRefillInput } from './refills/refill.service.js';
import { ReimbursementService } from './reimbursements/reimbursement.service.js';
import { ReportService } from './reports/report.service.js';
import { VolunteerService, type AvailabilityInput } from './volunteers/volunteer.service.js';

/** Composition facade retained for the existing route file and callers. Domain logic lives in each module service. */
export class SnackService {
  readonly employees: EmployeeService;
  readonly offices: OfficeService;
  readonly volunteers: VolunteerService;
  readonly refills: RefillService;
  readonly purchases: PurchaseService;
  readonly budgets: BudgetService;
  readonly reimbursements: ReimbursementService;
  readonly reports: ReportService;

  constructor(db: Database.Database, chat: ChatService, hr: HrService) {
    this.employees = new EmployeeService(db);
    this.offices = new OfficeService(db);
    this.volunteers = new VolunteerService(db);
    this.budgets = new BudgetService(db);
    this.reimbursements = new ReimbursementService(db, chat, hr);
    this.refills = new RefillService(db, this.employees, this.offices, this.volunteers, chat);
    this.purchases = new PurchaseService(db, this.budgets, chat, hr);
    this.reports = new ReportService(db, this.budgets);
  }

  listEmployees(officeId?: number): Row[] { return this.employees.listEmployees(officeId); }
  getEmployee(id: number): Row { return this.employees.getEmployee(id); }
  createEmployee(input: CreateEmployeeInput): Row { return this.employees.createEmployee(input); }
  updateEmployee(id: number, patch: UpdateEmployeeInput): Row { return this.employees.updateEmployee(id, patch); }

  listOffices(): Row[] { return this.offices.listOffices(); }
  getOffice(id: number): Row { return this.offices.getOffice(id); }
  listCounters(officeId?: number): Row[] { return this.offices.listCounters(officeId); }
  getCounter(id: number): Row { return this.offices.getCounter(id); }
  createCounter(input: CreateCounterInput): Row { return this.offices.createCounter(input); }
  updateCounter(id: number, patch: UpdateCounterInput): Row { return this.offices.updateCounter(id, patch); }

  optIn(employeeId: number): Row[] { return this.volunteers.optIn(employeeId); }
  optOut(employeeId: number): Row[] { return this.volunteers.optOut(employeeId); }
  updateAvailability(employeeId: number, input: AvailabilityInput): Row[] { return this.volunteers.updateAvailability(employeeId, input); }
  listVolunteers(officeId?: number): Row[] { return this.volunteers.listVolunteers(officeId); }

  createRefill(input: CreateRefillInput) { return this.refills.createRefill(input); }
  listRefills(): Row[] { return this.refills.listRefills(); }
  getRefill(id: number) { return this.refills.getRefill(id); }
  acceptRefill(refillId: number, employeeId: number) { return this.refills.acceptRefill(refillId, employeeId); }
  declineRefill(refillId: number, employeeId: number) { return this.refills.declineRefill(refillId, employeeId); }
  runAssignmentExpiryJob(now?: Date) { return this.refills.runAssignmentExpiryJob(now); }
  completeRefill(refillId: number, employeeId: number) { return this.refills.completeRefill(refillId, employeeId); }
  cancelRefill(refillId: number) { return this.refills.cancelRefill(refillId); }

  purchaseRefill(refillId: number, employeeId: number, input: PurchaseInput) { return this.purchases.purchaseRefill(refillId, employeeId, input); }

  getBudget(officeId: number, year?: number, month?: number) { return this.budgets.getBudget(officeId, year, month); }
  listBudgets(year?: number, month?: number) { return this.budgets.listBudgets(year, month); }
  setBudget(input: SetBudgetInput) { return this.budgets.setBudget(input); }

  listReimbursements(): Row[] { return this.reimbursements.listReimbursements(); }
  getReimbursement(id: number): Row { return this.reimbursements.getReimbursement(id); }
  retryClaim(id: number) { return this.reimbursements.retryClaim(id); }
  updateMockHrClaim(claimId: string, status: 'approved' | 'rejected' | 'reimbursed', reason?: string) {
    return this.reimbursements.updateMockHrClaim(claimId, status, reason);
  }

  monthlyReport(year: number, month: number) { return this.reports.monthlyReport(year, month); }
}
