export type AiProviderErrorCode =
  | "not_configured"
  | "timeout"
  | "rate_limited"
  | "unauthorized"
  | "upstream_http_error"
  | "network_error"
  | "empty_content"
  | "empty_vectors";

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly status?: number;

  constructor(input: { code: AiProviderErrorCode; message: string; status?: number }) {
    super(input.message);
    this.name = "AiProviderError";
    this.code = input.code;
    this.status = input.status;
  }
}

export function isAiProviderError(err: unknown): err is AiProviderError {
  return err instanceof AiProviderError;
}

