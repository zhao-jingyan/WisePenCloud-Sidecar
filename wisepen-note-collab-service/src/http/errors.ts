import { BlockIdMappingError } from '../ai-note/block-id-mapping';
import { InvalidRequestError } from '../ai-note/request-parser';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function toHttpError(error: unknown): HttpError | undefined {
  if (error instanceof HttpError) return error;
  if (error instanceof InvalidRequestError) {
    return new HttpError(400, 'INVALID_REQUEST', error.message);
  }
  if (error instanceof BlockIdMappingError) {
    return new HttpError(409, 'BLOCK_ID_MAPPING_NOT_FOUND', error.message);
  }
  return undefined;
}
