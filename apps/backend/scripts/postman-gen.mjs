/**
 * Generate a Postman collection from the OpenAPI spec.
 *
 * Runs after forge-ts build. Reads openapi.json, post-processes it
 * (fixing path params), then emits postman-collection.json.
 *
 * Usage: node scripts/postman-gen.mjs
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(__dirname, '..');
const repoRoot = resolve(backendDir, '..', '..');
const openapiPath = resolve(backendDir, 'openapi.json');
const postmanPath = resolve(backendDir, 'postman-collection.json');
const docsOpenapiPath = resolve(repoRoot, 'apps', 'docs', 'public', 'api', 'openapi.json');

// Step 1: Post-process openapi.json (fix path params, inject server info)
const postprocessScript = resolve(__dirname, 'postprocess-openapi.mjs');
console.log('Post-processing openapi.json...');
execFileSync(process.execPath, [postprocessScript, openapiPath], { stdio: 'inherit' });

// Step 2: Convert to Postman collection using openapi-to-postmanv2
if (!existsSync(openapiPath)) {
  console.error('openapi.json not found after post-processing');
  process.exit(1);
}

// Step 3: Copy updated spec to docs site public directory
try {
  copyFileSync(openapiPath, docsOpenapiPath);
  console.log(`Copied openapi.json to docs site: ${docsOpenapiPath}`);
} catch (err) {
  // Non-fatal: docs directory may not exist in all environments
  console.warn(`Warning: could not copy openapi.json to docs site: ${err.message}`);
}

try {
  const Converter = (await import('openapi-to-postmanv2')).default;
  const openapiContent = readFileSync(openapiPath, 'utf-8');
  const openapiJson = JSON.parse(openapiContent);

  Converter.convert(
    { type: 'json', data: openapiJson },
    {
      requestNameFolders: true,
      folderStrategy: 'Tags',
      optimizeConversion: false,
      stackLimit: 100,
    },
    (_err, result) => {
      if (!result.result) {
        console.error('Conversion failed:', result.reason);
        process.exit(1);
      }
      const collection = result.output[0].data;
      writeFileSync(postmanPath, JSON.stringify(collection, null, 2), 'utf-8');
      console.log(`Postman collection generated: ${postmanPath}`);
      console.log(`  Items: ${collection.item?.length ?? 0} top-level folders`);
    }
  );
} catch (err) {
  console.error('Failed to generate Postman collection:', err.message);
  // Non-fatal: openapi.json is still valuable even if Postman gen fails
  process.exit(0);
}
