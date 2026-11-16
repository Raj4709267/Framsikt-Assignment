import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { HttpError } from '../shared/errors/http-error.js';
import type { SnackService } from './snack.service.js';

const positiveId = z.coerce.number().int().positive();
const idParam = (raw: unknown) => positiveId.parse(raw);
const parseBody = <T extends z.ZodType>(schema: T, value: unknown): z.output<T> => schema.parse(value);
const success = (data: unknown, message = 'Operation completed successfully') => ({ success: true, data, message });
const router = Router();

const receiptDirectory = process.env.UPLOADS_DIRECTORY ?? join(process.cwd(), 'uploads', 'receipts');
mkdirSync(receiptDirectory, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, receiptDirectory),
    filename: (_request, file, callback) => callback(null, `${Date.now()}-${randomUUID()}${file.originalname.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ''}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) callback(new HttpError(400, 'Receipt must be a JPEG, PNG, or WebP image'));
    else callback(null, true);
  },
});

export function createApiRouter(service: SnackService) {
  const api = Router();
  const employeeSchema = z.object({ name: z.string().trim().min(1).max(120), email: z.email(), officeId: positiveId });
  api.post('/employees', (req, res) => res.status(201).json(success(service.createEmployee(parseBody(employeeSchema, req.body)), 'Employee created')));
  api.get('/employees', (req, res) => res.json(success(service.listEmployees(req.query.officeId === undefined ? undefined : positiveId.parse(req.query.officeId)))));
  api.get('/employees/:id', (req, res) => res.json(success(service.getEmployee(idParam(req.params.id!)))));
  api.patch('/employees/:id', (req, res) => {
    const schema = employeeSchema.partial().extend({ isActive: z.boolean().optional() });
    res.json(success(service.updateEmployee(idParam(req.params.id!), parseBody(schema, req.body)), 'Employee updated'));
  });

  api.get('/offices', (_req, res) => res.json(success(service.listOffices())));
  api.get('/offices/:id', (req, res) => res.json(success(service.getOffice(idParam(req.params.id!)))));
  const counterInput = z.object({ officeId: positiveId, name: z.string().trim().min(1).max(120), location: z.string().trim().min(1).max(200) });
  api.get('/snack-counters', (req, res) => res.json(success(service.listCounters(req.query.officeId === undefined ? undefined : positiveId.parse(req.query.officeId)))));
  api.post('/snack-counters', (req, res) => res.status(201).json(success(service.createCounter(parseBody(counterInput, req.body)), 'Snack counter created')));
  api.get('/snack-counters/:id', (req, res) => res.json(success(service.getCounter(idParam(req.params.id!)))));
  api.patch('/snack-counters/:id', (req, res) => {
    const schema = z.object({ name: z.string().trim().min(1).max(120).optional(), location: z.string().trim().min(1).max(200).optional(), isActive: z.boolean().optional() }).refine((input) => Object.keys(input).length > 0);
    res.json(success(service.updateCounter(idParam(req.params.id!), parseBody(schema, req.body)), 'Snack counter updated'));
  });

  api.post('/volunteers/opt-in', (req, res) => {
    const { employeeId } = parseBody(z.object({ employeeId: positiveId }), req.body);
    res.json(success(service.optIn(employeeId), 'Employee opted into volunteering'));
  });
  api.post('/volunteers/opt-out', (req, res) => {
    const { employeeId } = parseBody(z.object({ employeeId: positiveId }), req.body);
    res.json(success(service.optOut(employeeId), 'Employee opted out of volunteering'));
  });
  api.patch('/volunteers/:employeeId/availability', (req, res) => {
    const schema = z.object({ officeId: positiveId.optional(), status: z.enum(['available', 'unavailable', 'on_leave']),
      availableFrom: z.iso.datetime().optional(), availableUntil: z.iso.datetime().optional(), temporaryEligibility: z.boolean().default(false) });
    res.json(success(service.updateAvailability(idParam(req.params.employeeId!), parseBody(schema, req.body)), 'Volunteer availability updated'));
  });
  api.get('/volunteers', (req, res) => res.json(success(service.listVolunteers(req.query.officeId === undefined ? undefined : positiveId.parse(req.query.officeId)))));

  api.post('/refills', (req, res) => {
    const schema = z.object({ snackCounterId: positiveId, reportedByEmployeeId: positiveId, description: z.string().trim().min(1).max(1000) });
    res.status(201).json(success(service.createRefill(parseBody(schema, req.body)), 'Refill request created'));
  });
  api.get('/refills', (_req, res) => res.json(success(service.listRefills())));
  api.get('/refills/:id', (req, res) => res.json(success(service.getRefill(idParam(req.params.id!)))));
  api.post('/refills/:id/accept', (req, res) => {
    const { employeeId } = parseBody(z.object({ employeeId: positiveId }), req.body);
    res.json(success(service.acceptRefill(idParam(req.params.id!), employeeId), 'Assignment accepted'));
  });
  api.post('/refills/:id/decline', (req, res) => {
    const { employeeId } = parseBody(z.object({ employeeId: positiveId }), req.body);
    res.json(success(service.declineRefill(idParam(req.params.id!), employeeId), 'Assignment declined'));
  });
  api.post('/refills/:id/purchase', upload.single('receipt'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Receipt image is required');
    try {
      const content = readFileSync(req.file.path);
      const validImage = req.file.mimetype === 'image/png'
        ? content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : req.file.mimetype === 'image/jpeg'
          ? content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
          : content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP';
      if (!validImage) throw new HttpError(400, 'Receipt contents do not match the declared image type');
      const input = parseBody(z.object({ employeeId: positiveId, amount: z.coerce.number().positive().max(1000000),
        currency: z.enum(['NOK', 'INR']), description: z.string().trim().min(1).max(500), purchasedAt: z.iso.datetime().optional() }), req.body);
      const data = await service.purchaseRefill(idParam(req.params.id!), input.employeeId, { ...input, receiptPath: `uploads/receipts/${req.file.filename}` });
      res.status(201).json(success(data, 'Purchase recorded'));
    } catch (error) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(req.file.path);
      throw error;
    }
  });
  api.post('/refills/:id/complete', (req, res) => {
    const { employeeId } = parseBody(z.object({ employeeId: positiveId }), req.body);
    res.json(success(service.completeRefill(idParam(req.params.id!), employeeId), 'Refill completed'));
  });
  api.post('/refills/:id/cancel', (req, res) => res.json(success(service.cancelRefill(idParam(req.params.id!)), 'Refill cancelled')));

  api.get('/budgets', (req, res) => {
    const schema = z.object({ year: z.coerce.number().int().min(2000).max(2200).optional(), month: z.coerce.number().int().min(1).max(12).optional() });
    const query = parseBody(schema, req.query);
    res.json(success(service.listBudgets(query.year, query.month)));
  });
  api.get('/budgets/:officeId/:year/:month', (req, res) => {
    const params = parseBody(z.object({ officeId: positiveId, year: z.coerce.number().int().min(2000).max(2200), month: z.coerce.number().int().min(1).max(12) }), req.params);
    res.json(success(service.getBudget(params.officeId, params.year, params.month)));
  });
  api.get('/budgets/:officeId', (req, res) => res.json(success(service.getBudget(idParam(req.params.officeId!)))));
  api.post('/budgets', (req, res) => {
    const schema = z.object({ officeId: positiveId, year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12), budgetAmount: z.number().nonnegative() });
    res.json(success(service.setBudget(parseBody(schema, req.body)), 'Budget updated'));
  });

  api.get('/reimbursements', (_req, res) => res.json(success(service.listReimbursements())));
  api.get('/reimbursements/:id', (req, res) => res.json(success(service.getReimbursement(idParam(req.params.id!)))));
  api.post('/reimbursements/:id/retry', async (req, res) => res.json(success(await service.retryClaim(idParam(req.params.id!)), 'HR claim submission retried')));
  api.get('/reports/monthly', (req, res) => {
    const query = parseBody(z.object({ year: z.coerce.number().int().min(2000).max(2200), month: z.coerce.number().int().min(1).max(12) }), req.query);
    res.json(success(service.monthlyReport(query.year, query.month)));
  });

  const mockHrGuard = (_req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    if (process.env.NODE_ENV === 'production') { next(new HttpError(404, 'Not found')); return; }
    next();
  };
  api.use('/mock-hr', mockHrGuard);
  api.post('/mock-hr/claims/:claimId/approve', async (req, res) => res.json(success(await service.updateMockHrClaim(req.params.claimId!, 'approved'), 'Mock HR claim approved')));
  api.post('/mock-hr/claims/:claimId/reject', async (req, res) => {
    const { reason } = parseBody(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
    res.json(success(await service.updateMockHrClaim(req.params.claimId!, 'rejected', reason), 'Mock HR claim rejected'));
  });
  api.post('/mock-hr/claims/:claimId/mark-paid', async (req, res) => res.json(success(await service.updateMockHrClaim(req.params.claimId!, 'reimbursed'), 'Mock HR claim marked paid')));

  return api;
}
