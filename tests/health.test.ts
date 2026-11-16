import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createRuntime } from '../src/app.js';
describe('GET /health', () => {
  it('returns the service health payload', async () => {
    const runtime = createRuntime();
    const response = await request(runtime.app).get('/health');
    runtime.database.close();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: 'Snack Counter API is running' });
  });
});
