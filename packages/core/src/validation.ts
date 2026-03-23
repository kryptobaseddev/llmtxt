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

export interface ValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  format?: 'json' | 'text' | 'markdown';
}

export interface ValidationError {
  path: string;
  message: string;
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
 * Validate content as plain text / markdown.
 */
export function validateText(content: unknown): ValidationResult<string> {
  const result = textFormatSchema.safeParse(content);
  if (!result.success) {
    return { success: false, errors: formatZodErrors(result.error) };
  }
  return { success: true, data: result.data, format: 'text' };
}

/**
 * Auto-detect whether a string is JSON or text.
 */
export function detectFormat(content: string): 'json' | 'text' | 'markdown' {
  try {
    JSON.parse(content);
    return 'json';
  } catch {
    return 'text';
  }
}

/**
 * Validate content for a given format, with optional schema enforcement.
 */
export function validateContent(
  content: unknown,
  format: 'json' | 'text' | 'markdown',
  schemaName?: string,
): ValidationResult {
  switch (format) {
    case 'json':
      return validateJson(content, schemaName);
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
 * Auto-detect format then validate.
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
