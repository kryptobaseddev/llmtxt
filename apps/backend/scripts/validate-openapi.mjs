/**
 * Validate the generated OpenAPI spec against the OpenAPI 3.1 schema.
 *
 * Exits 0 on success, 1 on validation errors.
 *
 * Usage: node scripts/validate-openapi.mjs [specPath]
 * Default spec path: openapi.json (relative to cwd)
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const specPath = resolve(process.argv[2] ?? 'openapi.json');

let spec;
try {
  const raw = readFileSync(specPath, 'utf-8');
  spec = JSON.parse(raw);
} catch (err) {
  console.error(`ERROR: Could not read spec at ${specPath}: ${err.message}`);
  process.exit(1);
}

const OpenAPISchemaValidator = require('openapi-schema-validator').default;
const validator = new OpenAPISchemaValidator({ version: spec.openapi ?? '3.1.0' });
const result = validator.validate(spec);

const pathCount = Object.keys(spec.paths ?? {}).length;
const opCount = Object.values(spec.paths ?? {}).reduce((sum, item) => {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  return sum + Object.keys(item).filter(k => methods.includes(k)).length;
}, 0);

console.log(`OpenAPI validation: ${specPath}`);
console.log(`  Version : ${spec.openapi}`);
console.log(`  Paths   : ${pathCount}`);
console.log(`  Ops     : ${opCount}`);
console.log(`  Errors  : ${result.errors.length}`);

if (result.errors.length > 0) {
  console.error('\nValidation FAILED:');
  result.errors.forEach((e, i) => {
    console.error(`  [${i + 1}] ${e.instancePath} — ${e.message}`);
  });
  process.exit(1);
}

if (pathCount < 20) {
  console.error(`\nValidation FAILED: spec has only ${pathCount} paths (minimum 20 required).`);
  process.exit(1);
}

console.log('\nValidation PASSED.');
process.exit(0);
