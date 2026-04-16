/**
 * Zod validation schemas for llmtxt content formats.
 *
 * Includes predefined schemas for common LLM payloads and
 * request/response validation helpers.
 */
import { z } from 'zod';

// ── Format Schemas ──────────────────────────────────────────────

/**
 * Schema that accepts any valid JSON value.
 *
 * @remarks
 * Matches objects, arrays, strings, numbers, booleans, and null. Used as
 * the baseline structural check before optional predefined-schema enforcement.
 */
export const jsonFormatSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * Schema that accepts any string value (plain text or markdown).
 *
 * @remarks
 * No structural constraints beyond being a string. Used by
 * {@link validateText} in the validation layer.
 */
export const textFormatSchema = z.string();

/**
 * Schema for markdown content, stored as a plain string.
 *
 * @remarks
 * Functionally identical to {@link textFormatSchema}. Exists as a
 * distinct export so callers can signal intent when working with
 * markdown-specific pipelines.
 */
export const markdownFormatSchema = z.string();

// ── Predefined Content Schemas ──────────────────────────────────

/**
 * Schema for a single message within an LLM prompt conversation.
 *
 * @remarks
 * Validates that each message has a `role` (system, user, or assistant)
 * and a `content` string, matching the format used by OpenAI and
 * Anthropic APIs.
 */
export const promptMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

/**
 * Schema for the standard LLM prompt format (OpenAI / Anthropic style).
 *
 * @remarks
 * Validates an object with an optional `system` prompt, a non-empty
 * `messages` array of {@link promptMessageSchema} entries, and optional
 * `temperature` (0-2) and `max_tokens` (positive integer) fields.
 */
export const promptV1Schema = z.object({
  system: z.string().optional(),
  messages: z.array(promptMessageSchema).min(1, 'At least one message is required'),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

// ── Schema Registry ─────────────────────────────────────────────

/**
 * Registry of predefined content schemas keyed by name.
 *
 * @remarks
 * Used by the validation layer to look up schemas by string name at
 * runtime. Extend this object to register additional predefined formats.
 */
export const predefinedSchemas = {
  'prompt-v1': promptV1Schema,
} as const;

/**
 * Union of all registered predefined schema name strings.
 *
 * @remarks
 * Derived from the keys of the {@link predefinedSchemas} registry.
 * Currently resolves to `"prompt-v1"`.
 */
export type PredefinedSchemaName = keyof typeof predefinedSchemas;

/**
 * Type-guard that checks whether a string is a registered predefined schema name.
 *
 * @remarks
 * Narrows the type of `name` to {@link PredefinedSchemaName} when `true`,
 * enabling safe indexing into the {@link predefinedSchemas} registry.
 *
 * @param name - The schema name to check.
 * @returns `true` if `name` is a key in the predefined schema registry.
 *
 * @example
 * ```ts
 * if (isPredefinedSchema('prompt-v1')) {
 *   const schema = predefinedSchemas['prompt-v1'];
 * }
 * ```
 */
export function isPredefinedSchema(name: string): name is PredefinedSchemaName {
  return name in predefinedSchemas;
}

/**
 * Retrieve a predefined Zod schema by name.
 *
 * @remarks
 * Returns `undefined` when the name is not found in the registry, allowing
 * callers to gracefully handle unknown schema names.
 *
 * @param name - The schema name to look up.
 * @returns The matching Zod schema, or `undefined` if not found.
 *
 * @example
 * ```ts
 * const schema = getPredefinedSchema('prompt-v1');
 * if (schema) schema.parse(data);
 * ```
 */
export function getPredefinedSchema(name: string): z.ZodType | undefined {
  return predefinedSchemas[name as PredefinedSchemaName];
}

// ── Request Schemas ─────────────────────────────────────────────

/**
 * Schema for incoming content compression requests.
 *
 * @remarks
 * Validates that the request includes non-empty `content` and an optional
 * `format` (defaults to `"text"`), optional `schema` name for predefined
 * validation, and optional arbitrary `metadata`.
 */
export const compressRequestSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  format: z.enum(['json', 'text', 'markdown']).optional().default('text'),
  schema: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for incoming content decompression requests.
 *
 * @remarks
 * Validates that the request includes a non-empty `slug` identifying the
 * stored document to decompress.
 */
export const decompressRequestSchema = z.object({
  slug: z.string().min(1, 'Document slug is required'),
});

/**
 * Schema for incoming content search requests.
 *
 * @remarks
 * Validates that the request includes a non-empty `query` string and at
 * least one document `slug` to search within.
 */
export const searchRequestSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  slugs: z.array(z.string().min(1)).min(1, 'At least one slug is required'),
});

// ── Type Exports ────────────────────────────────────────────────

/**
 * Inferred TypeScript type for any valid JSON value (object, array, primitive).
 *
 * @remarks
 * Derived from {@link jsonFormatSchema}. Represents the union of all
 * JSON-compatible types: `Record<string, unknown>`, `unknown[]`, `string`,
 * `number`, `boolean`, and `null`.
 */
export type JsonFormat = z.infer<typeof jsonFormatSchema>;

/**
 * Inferred TypeScript type for plain text content.
 *
 * @remarks
 * Derived from {@link textFormatSchema}. Resolves to `string`.
 */
export type TextFormat = z.infer<typeof textFormatSchema>;

/**
 * Inferred TypeScript type for markdown content (string alias).
 *
 * @remarks
 * Derived from {@link markdownFormatSchema}. Resolves to `string`.
 */
export type MarkdownFormat = z.infer<typeof markdownFormatSchema>;

/**
 * Inferred TypeScript type for the standard LLM prompt format.
 *
 * @remarks
 * Derived from {@link promptV1Schema}. Includes optional `system` string,
 * required `messages` array, and optional `temperature` and `max_tokens`.
 */
export type PromptV1 = z.infer<typeof promptV1Schema>;

/**
 * Inferred TypeScript type for a single prompt message with role and content.
 *
 * @remarks
 * Derived from {@link promptMessageSchema}. Each message has a `role`
 * (`"system"`, `"user"`, or `"assistant"`) and a `content` string.
 */
export type PromptMessage = z.infer<typeof promptMessageSchema>;

/**
 * Inferred TypeScript type for content compression request payloads.
 *
 * @remarks
 * Derived from {@link compressRequestSchema}. Includes required `content`,
 * optional `format`, optional `schema`, and optional `metadata`.
 */
export type CompressRequest = z.infer<typeof compressRequestSchema>;

/**
 * Inferred TypeScript type for content decompression request payloads.
 *
 * @remarks
 * Derived from {@link decompressRequestSchema}. Contains a required `slug` field.
 */
export type DecompressRequest = z.infer<typeof decompressRequestSchema>;

/**
 * Inferred TypeScript type for content search request payloads.
 *
 * @remarks
 * Derived from {@link searchRequestSchema}. Contains a required `query`
 * string and a non-empty `slugs` array.
 */
export type SearchRequest = z.infer<typeof searchRequestSchema>;
