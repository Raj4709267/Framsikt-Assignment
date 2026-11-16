import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// Keep any SQLite opened by tests out of the development data directory.
const testRoot = mkdtempSync(join(tmpdir(), 'snack-counter-test-'));
process.env.DATABASE_PATH = join(testRoot, 'health.db');
process.env.UPLOADS_DIRECTORY = join(testRoot, 'receipts');
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
afterAll(() => rmSync(testRoot, { recursive: true, force: true }));
