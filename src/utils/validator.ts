// Validation utilities for LLMtxt dual format support
import { ZodError, ZodSchema } from 'zod';
import {
  jsonFormatSchema,
  textFormatSchema,
  getPredefinedSchema,
  isPredefinedSchema,
  predefinedSchemas,
} from '../schemas/validation.js';

/**
 * Validation result type
 */
export interface ValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
  format?: 'json' | 'text' | 'markdown';
}

/**
 * Validation error structure
 */
export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Format Zod errors into a clean array
 */
function formatZodErrors(error: ZodError): ValidationError[] {
  return error.errors.map((err) => ({
    path: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
}

/**
 * Validate JSON content
 * @param content - The content to validate (will be parsed if string)
 * @param schemaName - Optional predefined schema name to validate against
 * @returns ValidationResult with parsed data or errors
 * 
 * @example
 * // Basic JSON validation
 * const result = validateJson('{"foo": "bar"}');
 * 
 * // With predefined schema
 * const result = validateJson(jsonString, 'prompt-v1');
 */
export function validateJson(content: unknown, schemaName?: string): ValidationResult {
  // Step 1: Parse the content if it's a string
  let parsedContent: unknown;
  
  if (typeof content === 'string') {
    try {
      parsedContent = JSON.parse(content);
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            path: '',
            message: `Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
            code: 'invalid_json',
          },
        ],
      };
    }
  } else {
    parsedContent = content;
  }

  // Step 2: Validate it's valid JSON structure
  const jsonResult = jsonFormatSchema.safeParse(parsedContent);
  if (!jsonResult.success) {
    return {
      success: false,
      errors: formatZodErrors(jsonResult.error),
    };
  }

  // Step 3: If schema name provided, validate against predefined schema
  if (schemaName) {
    if (!isPredefinedSchema(schemaName)) {
      return {
        success: false,
        errors: [
          {
            path: 'schema',
            message: `Unknown schema '${schemaName}'. Available schemas: ${Object.keys(predefinedSchemas).join(', ')}`,
            code: 'unknown_schema',
          },
        ],
      };
    }

    const schema = getPredefinedSchema(schemaName);
    if (schema) {
      const schemaResult = schema.safeParse(parsedContent);
      if (!schemaResult.success) {
        return {
          success: false,
          errors: formatZodErrors(schemaResult.error),
        };
      }
      return {
        success: true,
        data: schemaResult.data,
        format: 'json',
      };
    }
  }

  // Return validated JSON data
  return {
    success: true,
    data: jsonResult.data,
    format: 'json',
  };
}

/**
 * Validate text content
 * Text format accepts any string content
 * @param content - The content to validate
 * @returns ValidationResult with the content or errors
 * 
 * @example
 * const result = validateText('# Markdown Header\n\nSome content');
 * // Always succeeds for strings
 */
export function validateText(content: unknown): ValidationResult<string> {
  const result = textFormatSchema.safeParse(content);
  
  if (!result.success) {
    return {
      success: false,
      errors: formatZodErrors(result.error),
    };
  }

  return {
    success: true,
    data: result.data,
    format: 'text',
  };
}

/**
 * Auto-detect format of content
 * Attempts to parse as JSON, if successful returns 'json', otherwise 'text'
 * @param content - The content to analyze
 * @returns 'json' if valid JSON, 'text' otherwise
 * 
 * @example
 * detectFormat('{"key": "value"}'); // 'json'
 * detectFormat('Hello world'); // 'text'
 * detectFormat('# Markdown'); // 'text'
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
 * Validate content based on specified format
 * @param content - The content to validate
 * @param format - The format to validate as ('json' or 'text')
 * @param schemaName - Optional schema name for JSON validation
 * @returns ValidationResult with parsed data or errors
 * 
 * @example
 * const result = validateContent('{"foo": "bar"}', 'json');
 * const result = validateContent('# Hello', 'text');
 * const result = validateContent(jsonString, 'json', 'prompt-v1');
 */
export function validateContent(
  content: unknown,
  format: 'json' | 'text' | 'markdown',
  schemaName?: string
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
        errors: [
          {
            path: 'format',
            message: `Invalid format '${format}'. Must be 'json', 'text', or 'markdown'`,
            code: 'invalid_format',
          },
        ],
      };
  }
}

/**
 * Auto-validate content by detecting format
 * @param content - The content to validate (should be a string)
 * @param schemaName - Optional schema name for JSON validation
 * @returns ValidationResult with parsed data or errors
 * 
 * @example
 * const result = autoValidate('{"foo": "bar"}'); // Validates as JSON
 * const result = autoValidate('Hello world'); // Validates as text
 */
export function autoValidate(content: unknown, schemaName?: string): ValidationResult {
  if (typeof content !== 'string') {
    return {
      success: false,
      errors: [
        {
          path: '',
          message: 'Content must be a string',
          code: 'invalid_type',
        },
      ],
    };
  }

  const format = detectFormat(content);
  return validateContent(content, format as 'json' | 'text', schemaName);
}
