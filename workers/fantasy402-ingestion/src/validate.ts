import { z } from "zod";

export type ValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export type ValidationErrorBody = {
  status: "failed";
  message: string;
  code: "VALIDATION_ERROR";
  issues: ValidationIssue[];
};

/** Flatten Zod errors into API-friendly issue list. */
export function formatZodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join(".") : "_",
    message: issue.message,
    code: issue.code,
  }));
}

export function validationErrorMessage(error: z.ZodError): string {
  const issues = formatZodIssues(error);
  if (!issues.length) return "Validation failed";
  if (issues.length === 1) return issues[0]!.message;
  return `${issues[0]!.message} (+${issues.length - 1} more)`;
}

export function validationErrorBody(error: z.ZodError): ValidationErrorBody {
  return {
    status: "failed",
    message: validationErrorMessage(error),
    code: "VALIDATION_ERROR",
    issues: formatZodIssues(error),
  };
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: z.ZodError };

export function parseSearchParams<T extends z.ZodTypeAny>(
  schema: T,
  searchParams: URLSearchParams,
): ParseResult<z.infer<T>> {
  const raw = Object.fromEntries(searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}

export function parseJsonValue<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(value);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}

/** Build a 400 JSON response from a Zod error (pass the worker's `json` helper). */
export function validationJsonResponse(
  error: z.ZodError,
  json: (body: unknown, status: number) => Response,
): Response {
  return json(validationErrorBody(error), 400);
}

export type ParseOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  searchParams: URLSearchParams,
  json: (body: unknown, status: number) => Response,
): ParseOutcome<z.infer<T>> {
  const result = parseSearchParams(schema, searchParams);
  if (!result.ok) {
    return { ok: false, response: validationJsonResponse(result.error, json) };
  }
  return { ok: true, data: result.data };
}

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  json: (body: unknown, status: number) => Response,
): ParseOutcome<z.infer<T>> {
  const result = parseJsonValue(schema, value);
  if (!result.ok) {
    return { ok: false, response: validationJsonResponse(result.error, json) };
  }
  return { ok: true, data: result.data };
}
