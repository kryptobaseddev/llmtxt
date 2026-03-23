/**
 * Content validation: format detection, JSON/text/markdown validation,
 * and optional predefined-schema enforcement.
 */
import { ZodError } from 'zod';
import {
  jsonFormatSchema,
  textFormatSchema,
  getPredefinedSchema,
  isPredefinedSchema,
  predefinedSchemas,
} from './schemas.js';

// ── Types ───────────────────────────────────────────────────────

/**
 * Outcome of a content validation operation.
 *
 * @remarks
 * Returned by every validation function in this module. When `success` is
 * `true`, `data` holds the parsed value and `format` indicates the detected
 * content type. When `success` is `false`, `errors` describes what went wrong.
 *
 * @typeParam T - The expected shape of the validated data (defaults to `unknown`).
 */
export interface ValidationResult<T = unknown> {
  /** Whether the validation passed without errors. */
  success: boolean;
  /** The parsed/validated data, present only when `success` is `true`. */
  data?: T;
  /** List of validation errors, present only when `success` is `false`. */
  errors?: ValidationError[];
  /** The detected or requested content format, when determinable. */
  format?: 'json' | 'text' | 'markdown';
}

/**
 * A single validation error with location, message, and error code.
 *
 * @remarks
 * Modeled after Zod issue objects but flattened for easy serialization.
 * The `path` uses dot-delimited notation (empty string for the root value).
 */
export interface ValidationError {
  /** Dot-delimited path to the field that failed validation (empty string for root). */
  path: string;
  /** Human-readable description of the validation failure. */
  message: string;
  /** Machine-readable error code (e.g. `"invalid_json"`, `"unknown_schema"`). */
  code: string;
}

// ── Helpers ─────────────────────────────────────────────────────

function formatZodErrors(error: ZodError): ValidationError[] {
  return error.errors.map((err) => ({
    path: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
}

// ── Validators ──────────────────────────────────────────────────

/**
 * Validate content as JSON, optionally against a predefined schema.
 *
 * @remarks
 * When `content` is a string it is first parsed with `JSON.parse`. The
 * parsed value is then checked against the generic JSON schema and,
 * when a `schemaName` is provided, against the matching predefined
 * schema from the registry.
 *
 * @param content - The raw content to validate (string or pre-parsed value).
 * @param schemaName - Optional name of a predefined schema to enforce.
 * @returns A {@link ValidationResult} indicating success or listing errors.
 *
 * @example
 * ```ts
 * const result = validateJson('{"key": "value"}');
 * if (result.success) console.log(result.data);
 * ```
 */
export function validateJson(content: unknown, schemaName?: string): ValidationResult {
  let parsedContent: unknown;

  if (typeof content === 'string') {
    try {
      parsedContent = JSON.parse(content);
    } catch (error) {
      return {
        success: false,
        errors: [{
          path: '',
          message: `Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
          code: 'invalid_json',
        }],
      };
    }
  } else {
    parsedContent = content;
  }

  const jsonResult = jsonFormatSchema.safeParse(parsedContent);
  if (!jsonResult.success) {
    return { success: false, errors: formatZodErrors(jsonResult.error) };
  }

  if (schemaName) {
    if (!isPredefinedSchema(schemaName)) {
      return {
        success: false,
        errors: [{
          path: 'schema',
          message: `Unknown schema '${schemaName}'. Available schemas: ${Object.keys(predefinedSchemas).join(', ')}`,
          code: 'unknown_schema',
        }],
      };
    }

    const schema = getPredefinedSchema(schemaName);
    if (schema) {
      const schemaResult = schema.safeParse(parsedContent);
      if (!schemaResult.success) {
        return { success: false, errors: formatZodErrors(schemaResult.error) };
      }
      return { success: true, data: schemaResult.data, format: 'json' };
    }
  }

  return { success: true, data: jsonResult.data, format: 'json' };
}

/**
 * Validate content as plain text or markdown.
 *
 * @remarks
 * Checks that the value is a string using the text format schema.
 *
 * @param content - The value to validate as text.
 * @returns A {@link ValidationResult} with `format` set to `"text"` on success.
 *
 * @example
 * ```ts
 * const result = validateText('# Hello');
 * ```
 */
export function validateText(content: unknown): ValidationResult<string> {
  const result = textFormatSchema.safeParse(content);
  if (!result.success) {
    return { success: false, errors: formatZodErrors(result.error) };
  }
  return { success: true, data: result.data, format: 'text' };
}

// Markdown signals used by detectFormat — must match disclosure.ts heuristics
const MARKDOWN_SIGNALS = [
  /^#{1,6}\s/m,         // Headers
  /^\s*[-*]\s/m,        // Unordered lists
  /^\s*\d+\.\s/m,       // Ordered lists
  /```/,                // Code blocks
  /\[.+\]\(.+\)/,      // Links
];

/**
 * Auto-detect whether a string is JSON, markdown, or plain text.
 *
 * @remarks
 * Attempts JSON parsing first. For non-JSON content, applies markdown
 * heuristics (headings, lists, code blocks, links) — 2+ signals returns
 * `"markdown"`, otherwise `"text"`. This is now consistent with the
 * disclosure module's `detectDocumentFormat`.
 *
 * @param content - The string to inspect.
 * @returns The detected format: `"json"`, `"markdown"`, or `"text"`.
 *
 * @example
 * ```ts
 * detectFormat('{"a":1}');                    // "json"
 * detectFormat('# Title\n- item');            // "markdown"
 * detectFormat('Hello');                      // "text"
 * ```
 */
export function detectFormat(content: string): 'json' | 'text' | 'markdown' {
  try {
    JSON.parse(content);
    return 'json';
  } catch {
    const markdownScore = MARKDOWN_SIGNALS.filter(r => r.test(content)).length;
    return markdownScore >= 2 ? 'markdown' : 'text';
  }
}

/** Default maximum content size in bytes (5 MB). */
export const DEFAULT_MAX_CONTENT_BYTES = 5 * 1024 * 1024;

/** Options for content validation. */
export interface ValidateContentOptions {
  /** Optional predefined schema name for JSON validation. */
  schemaName?: string;
  /** Maximum content size in bytes. Set to 0 to disable. Default: 5 MB. */
  maxBytes?: number;
}

/**
 * Validate content for a given format, with optional schema enforcement
 * and content size limits.
 *
 * @remarks
 * Dispatches to {@link validateJson} for JSON content or
 * {@link validateText} for text/markdown. Enforces a byte-size limit
 * (default 5 MB) before format validation. Returns an error result when
 * an unsupported format string is supplied or content exceeds the limit.
 *
 * @param content - The raw content to validate.
 * @param format - The expected content format.
 * @param schemaNameOrOptions - A schema name string (backward compat) or options object.
 * @returns A {@link ValidationResult} indicating success or listing errors.
 *
 * @example
 * ```ts
 * validateContent(payload, 'json', 'prompt-v1');
 * validateContent(payload, 'text', { maxBytes: 10 * 1024 * 1024 });
 * ```
 */
export function validateContent(
  content: unknown,
  format: 'json' | 'text' | 'markdown',
  schemaNameOrOptions?: string | ValidateContentOptions,
): ValidationResult {
  // Normalize options — backward compat with string schemaName
  const opts: ValidateContentOptions = typeof schemaNameOrOptions === 'string'
    ? { schemaName: schemaNameOrOptions }
    : schemaNameOrOptions ?? {};

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_CONTENT_BYTES;

  // Enforce content size limit
  if (maxBytes > 0 && typeof content === 'string') {
    const byteLength = Buffer.byteLength(content, 'utf-8');
    if (byteLength > maxBytes) {
      const maxMB = (maxBytes / (1024 * 1024)).toFixed(1);
      const actualMB = (byteLength / (1024 * 1024)).toFixed(2);
      return {
        success: false,
        errors: [{
          path: '',
          message: `Content size ${actualMB} MB exceeds maximum ${maxMB} MB`,
          code: 'content_too_large',
        }],
      };
    }
  }

  switch (format) {
    case 'json':
      return validateJson(content, opts.schemaName);
    case 'text':
    case 'markdown':
      return validateText(content);
    default:
      return {
        success: false,
        errors: [{
          path: 'format',
          message: `Invalid format '${format}'. Must be 'json', 'text', or 'markdown'`,
          code: 'invalid_format',
        }],
      };
  }
}

/**
 * Auto-detect the content format and then validate accordingly.
 *
 * @remarks
 * Combines {@link detectFormat} and {@link validateContent} into a single
 * call. The content must be a string; non-string values immediately fail
 * with an `invalid_type` error.
 *
 * @param content - The raw content to auto-detect and validate.
 * @param schemaName - Optional predefined schema name for JSON validation.
 * @returns A {@link ValidationResult} with the detected format and validated data.
 *
 * @example
 * ```ts
 * const result = autoValidate('{"messages":[{"role":"user","content":"hi"}]}', 'prompt-v1');
 * ```
 */
export function autoValidate(content: unknown, schemaName?: string): ValidationResult {
  if (typeof content !== 'string') {
    return {
      success: false,
      errors: [{
        path: '',
        message: 'Content must be a string',
        code: 'invalid_type',
      }],
    };
  }

  const format = detectFormat(content);
  return validateContent(content, format as 'json' | 'text', schemaName);
}
