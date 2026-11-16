import type { SnackService } from '../modules/snack.service.js';

export function runAssignmentExpiryJob(service: Pick<SnackService, 'runAssignmentExpiryJob'>, now = new Date()) {
  return service.runAssignmentExpiryJob(now);
}

export function startAssignmentExpiryJob(service: Pick<SnackService, 'runAssignmentExpiryJob'>, intervalMs = 60_000): () => void {
  const timer = setInterval(() => runAssignmentExpiryJob(service), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
