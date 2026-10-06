// Errors thrown on purpose. The code is stable for the frontend; the message
// is safe to show to users. Anything else becomes a generic 500.
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You don\'t have permission to do this.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'This item could not be found.') => new AppError(404, 'not_found', message);
export const conflict = (code, message) => new AppError(409, code, message);
export const tooMany = () => new AppError(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
