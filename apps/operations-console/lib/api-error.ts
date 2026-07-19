export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: { error: string; message?: string }) {
    super(body.message ?? body.error);
    this.status = status;
    this.code = body.error;
  }
}
