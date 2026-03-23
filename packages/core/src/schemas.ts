/**
 * Zod validation schemas for llmtxt content formats.
 *
 * Includes predefined schemas for common LLM payloads and
 * request/response validation helpers.
 */
import { z } from 'zod';

// ── Format Schemas ──────────────────────────────────────────────

/** Accepts any valid JSON value. */
export const jsonFormatSchema = z.union([
  z.record(z.unknown()),
  z.array(z.unknown()),
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/** Accepts any string (plain text / markdown). */
export const textFormatSchema = z.string();

/** Alias for text — markdown is stored as a string. */
export const markdownFormatSchema = z.string();

// ── Predefined Content Schemas ──────────────────────────────────

export const promptMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

/** Standard LLM prompt format (OpenAI / Anthropic style). */
export const promptV1Schema = z.object({
  system: z.string().optional(),
  messages: z.array(promptMessageSchema).min(1, 'At least one message is required'),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

// ── Schema Registry ─────────────────────────────────────────────

export const predefinedSchemas = {
  'prompt-v1': promptV1Schema,
} as const;

export type PredefinedSchemaName = keyof typeof predefinedSchemas;

export function isPredefinedSchema(name: string): name is PredefinedSchemaName {
  return name in predefinedSchemas;
}

export function getPredefinedSchema(name: string): z.ZodSchema | undefined {
  return predefinedSchemas[name as PredefinedSchemaName];
}

// ── Request Schemas ─────────────────────────────────────────────

export const compressRequestSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  format: z.enum(['json', 'text', 'markdown']).optional().default('text'),
  schema: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const decompressRequestSchema = z.object({
  slug: z.string().min(1, 'Document slug is required'),
});

export const searchRequestSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  slugs: z.array(z.string().min(1)).min(1, 'At least one slug is required'),
});

// ── Type Exports ────────────────────────────────────────────────

export type JsonFormat = z.infer<typeof jsonFormatSchema>;
export type TextFormat = z.infer<typeof textFormatSchema>;
export type MarkdownFormat = z.infer<typeof markdownFormatSchema>;
export type PromptV1 = z.infer<typeof promptV1Schema>;
export type PromptMessage = z.infer<typeof promptMessageSchema>;
export type CompressRequest = z.infer<typeof compressRequestSchema>;
export type DecompressRequest = z.infer<typeof decompressRequestSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
