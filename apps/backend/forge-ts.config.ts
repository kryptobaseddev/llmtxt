import type { ForgeConfig } from "@forge-ts/core";

export default {
  rootDir: ".",
  outDir: "docs/generated",
  enforce: {
    rules: {
      'require-summary': 'warn',
      'require-param': 'warn',
      'require-returns': 'warn',
      'require-example': 'off',
      'require-package-doc': 'off',
      'require-class-member-doc': 'off',
      'require-interface-member-doc': 'off',
      'require-remarks': 'off',
      'require-default-value': 'off',
      'require-type-param': 'off',
      'require-release-tag': 'off',
    },
  },
  // T169 owns apps/backend/openapi.json — it is hand-curated (OpenAPI 3.1)
  // and served at /docs/api via Swagger UI. forge-ts MUST NOT claim this
  // file. Re-enabling the `api:` block here would overwrite T169's curated
  // spec with a generated 3.2 stub on the next `pnpm exec forge-ts build`
  // (regression observed on 2026-04-23 — see commit 41b1bc7). If/when the
  // openapi pipeline is migrated to `@route` / `@openapi` TSDoc tags,
  // redirect `openapiPath` to `docs/generated/openapi.forge.json` first,
  // then fold the content into the curated spec behind a diff review.
  gen: {
    formats: ['markdown'],
    llmsTxt: true,
  },
} satisfies Partial<ForgeConfig>;
