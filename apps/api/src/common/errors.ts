export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function notFound(code: string, message: string): ApiError {
  return new ApiError(404, code, message);
}
