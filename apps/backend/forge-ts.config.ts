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
  api: {
    enabled: true,
    openapi: true,
    openapiPath: 'openapi.json',
  },
  gen: {
    formats: ['markdown'],
    llmsTxt: true,
  },
} satisfies Partial<ForgeConfig>;
