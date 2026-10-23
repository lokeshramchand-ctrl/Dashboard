export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notConfigured = (what: string) => new HttpError(503, 'NOT_CONFIGURED', `${what} is not configured on the server`);
