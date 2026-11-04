/**
 * An error fit to show a person. `code` is stable and meant for clients; `message` is human
 * readable English. Plain on purpose: the team functions use it without loading the REST API.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Item') => new AppError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (message = 'You do not have access to this') => new AppError('FORBIDDEN', message, 403);
export const conflict = (code: string, message: string) => new AppError(code, message, 409);
