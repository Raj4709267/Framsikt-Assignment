import { createRuntime } from './app.js';
import { env } from './config/env.js';
import { migrateDatabase } from './database/migrate.js';
import { startAssignmentExpiryJob } from './jobs/assignment-expiry.job.js';

const runtime = createRuntime();
migrateDatabase(runtime.database);
const app = runtime.app;
const stopExpiryJob = startAssignmentExpiryJob(runtime.service);
const server = app.listen(env.PORT, () => {
  console.info(`Snack Counter API listening on port ${env.PORT}`);
});

const shutdown = () => {
  stopExpiryJob();
  server.close(() => runtime.database.close());
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
