import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../shared/errors/http-error.js';

export const errorMiddleware: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({ success: false, message: 'Request validation failed', errors: error.issues });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.status).json({ success: false, message: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Receipt image must be 5 MB or smaller' : 'Invalid receipt upload';
    response.status(400).json({ success: false, message });
    return;
  }
  if (error instanceof Error && ((error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')
    || error.message.includes('UNIQUE constraint failed') || error.message.includes('constraint failed'))) {
    response.status(409).json({ success: false, message: 'The request conflicts with existing data or an active workflow.' });
    return;
  }
  request.log?.error({ err: error }, 'Unhandled request error');
  const status = (error as { status?: number })?.status;
  const message = status && status < 500 && error instanceof Error ? error.message : 'Internal server error';
  response.status(status && status < 500 ? status : 500).json({ success: false, message });
};
