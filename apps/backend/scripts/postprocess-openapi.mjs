/**
 * Post-process the forge-ts generated openapi.json to:
 * 1. Detect path parameters (query params whose name matches a path segment)
 * 2. Convert matching segments to {param} OpenAPI template notation
 * 3. Fix in:"query" → in:"path" + required:true for those params
 * 4. Inject server info from config defaults
 *
 * forge-ts strips {slug} → slug because TSDoc interprets {...} as inline link tags.
 * This script recovers the intent by matching param names to path segments.
 *
 * Usage: node scripts/postprocess-openapi.mjs [inputPath] [outputPath]
 * Default: in-place on openapi.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const inputPath = resolve(process.argv[2] ?? 'openapi.json');
const outputPath = resolve(process.argv[3] ?? inputPath);

const raw = readFileSync(inputPath, 'utf-8');
const spec = JSON.parse(raw);

/**
 * Given a path string like /api/documents/slug/versions/num and a set of
 * parameter names from the operation (e.g. {slug, num}), return the OpenAPI
 * path template: /api/documents/{slug}/versions/{num}
 */
function templatePath(rawPath, paramNames) {
  const segments = rawPath.split('/');
  return segments.map(seg => {
    if (paramNames.has(seg)) return `{${seg}}`;
    return seg;
  }).join('/');
}

/**
 * Collect all query-param names from an operation that look like they should
 * be path params (their name appears verbatim as a path segment).
 */
function detectPathParams(rawPath, operation) {
  const segments = new Set(rawPath.split('/').filter(s => s.length > 0));
  const pathParamNames = new Set();
  for (const param of (operation.parameters ?? [])) {
    if (segments.has(param.name)) {
      pathParamNames.add(param.name);
    }
  }
  return pathParamNames;
}

// Collect all param names across ALL operations in a path item
// so we get a consistent template for all methods sharing a path
function collectAllPathParams(rawPath, pathItem) {
  const allNames = new Set();
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!operation || typeof operation !== 'object') continue;
    const names = detectPathParams(rawPath, operation);
    for (const n of names) allNames.add(n);
  }
  return allNames;
}

const newPaths = {};

for (const [rawPath, pathItem] of Object.entries(spec.paths)) {
  // Find all path-segment param names across all methods
  const allPathParamNames = collectAllPathParams(rawPath, pathItem);

  // Build the templated path (e.g. /api/documents/{slug}/versions/{num})
  const templateKey = allPathParamNames.size > 0
    ? templatePath(rawPath, allPathParamNames)
    : rawPath;

  // Fix each operation: upgrade query params → path params where applicable
  const newPathItem = {};
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!operation || typeof operation !== 'object') {
      newPathItem[method] = operation;
      continue;
    }
    const newParams = (operation.parameters ?? []).map(param => {
      if (allPathParamNames.has(param.name) && param.in === 'query') {
        return { ...param, in: 'path', required: true };
      }
      return param;
    });
    newPathItem[method] = { ...operation, parameters: newParams };
  }

  newPaths[templateKey] = newPathItem;
}

spec.paths = newPaths;

// Inject server info
if (!spec.info) spec.info = {};
spec.info.title = spec.info.title || 'LLMtxt API';
spec.info.version = spec.info.version || '2026.4.4';
spec.info.description = spec.info.description ||
  'LLMtxt — agent-first document storage, compression, versioning, and multi-agent collaboration. ' +
  'Routes prefixed with /api. Auth via Bearer API key (Authorization: Bearer <key>) or session cookie.';
spec.info['x-logo'] = { url: 'https://llmtxt.my/favicon.svg' };

if (!spec.servers || spec.servers.length === 0) {
  spec.servers = [
    { url: 'https://api.llmtxt.my', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local dev' },
  ];
}

writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');
const routeCount = Object.keys(spec.paths).length;
const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
const paramsFixed = Object.values(spec.paths).flatMap(item =>
  Object.values(item).flatMap(op => (op?.parameters ?? []).filter(p => p.in === 'path'))
).length;
console.log(`OpenAPI spec post-processed: ${outputPath}`);
console.log(`  Routes: ${routeCount}, Schemas: ${schemaCount}, Path params fixed: ${paramsFixed}`);
