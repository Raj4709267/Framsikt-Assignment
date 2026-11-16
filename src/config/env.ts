import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/snack-counter.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ASSIGNMENT_OFFER_TTL_HOURS: z.coerce.number().positive().default(24),
  ASSIGNMENT_COMPLETION_TTL_HOURS: z.coerce.number().positive().default(48),
  OVER_BUDGET_POLICY: z.enum(['block', 'approval_required']).default('block'),
});

export const env = envSchema.parse(process.env);
