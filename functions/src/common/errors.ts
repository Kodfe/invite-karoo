import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error';

export { AppError, conflict, forbidden, notFound } from './app-error';

/**
 * Every error the API returns has the same shape:
 *   { error: { code: 'RSVP_CLOSED', message: 'Replies for this function closed ...', fields?: {...} } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('API');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AppError) {
      return res.status(exception.status).json({ error: { code: exception.code, message: exception.message, fields: exception.fields } });
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r = exception.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? exception.message);
      const code = status === 401 ? 'UNAUTHORIZED' : status === 404 ? 'NOT_FOUND' : status === 429 ? 'TOO_MANY_REQUESTS' : 'HTTP_' + status;
      return res.status(status).json({ error: { code, message: Array.isArray(message) ? message.join(', ') : message } });
    }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
  }
}
