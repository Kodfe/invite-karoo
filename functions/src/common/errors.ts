import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Every error the API returns has the same shape:
 *   { error: { code: 'RSVP_CLOSED', message: 'Replies for this function closed ...', fields?: {...} } }
 * `code` is stable and meant for the app; `message` is human readable English.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
    public readonly fields?: Record<string, string>,
  ) {
    super({ code, message, fields }, status);
  }
}

export const notFound = (what = 'Item') => new AppError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (message = 'You do not have access to this') => new AppError('FORBIDDEN', message, 403);
export const conflict = (code: string, message: string) => new AppError(code, message, 409);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('API');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AppError) {
      const body = exception.getResponse() as { code: string; message: string; fields?: unknown };
      return res.status(exception.getStatus()).json({ error: body });
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
