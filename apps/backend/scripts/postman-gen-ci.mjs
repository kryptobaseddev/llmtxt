/**
 * CI-only Postman collection generator.
 *
 * Reads the already-committed openapi.json and emits postman-collection.json.
 * Does NOT rebuild the spec (no forge-ts dependency) — use openapi:gen for full regen.
 *
 * Usage: node scripts/postman-gen-ci.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(__dirname, "..");
const openapiPath = resolve(backendDir, "openapi.json");
const postmanPath = resolve(backendDir, "postman-collection.json");

if (!existsSync(openapiPath)) {
	console.error("ERROR: openapi.json not found at", openapiPath);
	process.exit(1);
}

const Converter = (await import("openapi-to-postmanv2")).default;
const openapiContent = readFileSync(openapiPath, "utf-8");
const openapiJson = JSON.parse(openapiContent);

Converter.convert(
	{ type: "json", data: openapiJson },
	{
		requestNameFolders: true,
		folderStrategy: "Tags",
		optimizeConversion: false,
		stackLimit: 100,
	},
	(_err, result) => {
		if (!result.result) {
			console.error("Conversion failed:", result.reason);
			process.exit(1);
		}
		const collection = result.output[0].data;
		writeFileSync(postmanPath, JSON.stringify(collection, null, 2), "utf-8");
		console.log("Postman collection generated:", postmanPath);
		console.log("  Top-level folders:", collection.item?.length ?? 0);
		const total = (collection.item ?? []).reduce(
			(s, f) => s + (f.item?.length ?? 0),
			0,
		);
		console.log("  Total requests:", total);
	},
);
