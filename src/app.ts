import express from 'express';
import pinoHttp from 'pino-http';
import type Database from 'better-sqlite3';
import { env } from './config/env.js';
import { openDatabase } from './database/connection.js';
import { MockChatService } from './integrations/chat/chat.mock.js';
import type { ChatService } from './integrations/chat/chat.interface.js';
import { MockHrService } from './integrations/hr/hr.mock.js';
import type { HrService } from './integrations/hr/hr.interface.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { createApiRouter } from './modules/api.routes.js';
import { SnackService } from './modules/snack.service.js';

export function createRuntime(options: { database?: Database.Database; chat?: ChatService; hr?: HrService } = {}): {
  app: express.Express; database: Database.Database; service: SnackService; chat: ChatService; hr: HrService;
} {
  const database = options.database ?? openDatabase();
  const chat = options.chat ?? new MockChatService();
  const hr = options.hr ?? new MockHrService();
  const service = new SnackService(database, chat, hr);
  const app = express();
  const requestLogger = pinoHttp as unknown as (options: { level: string }) => express.RequestHandler;
  app.use(requestLogger({ level: env.LOG_LEVEL }));
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_request, response) => {
    response.json({ success: true, message: 'Snack Counter API is running' });
  });
  app.use('/api', createApiRouter(service));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return { app, database, service, chat, hr };
}

export function createApp(options: { database?: Database.Database; chat?: ChatService; hr?: HrService } = {}) {
  return createRuntime(options).app;
}
