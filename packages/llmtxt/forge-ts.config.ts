import type { ForgeConfig } from '@forge-ts/core';

export default {
  rootDir: '.',
  outDir: './docs/generated',
  enforce: {
    rules: {
      'require-summary': 'warn',
      'require-param': 'off',
      'require-returns': 'off',
      'require-example': 'off',
      'require-package-doc': 'off',
      'require-class-member-doc': 'off',
      'require-interface-member-doc': 'off',
      'require-remarks': 'off',
      'require-default-value': 'off',
      'require-type-param': 'off',
      'require-release-tag': 'off'
    }
  },
  gen: {
    formats: ['markdown'],
    llmsTxt: true
  },
  guards: {
    tsconfig: { enabled: true },
    biome: { enabled: false },
    packageJson: { enabled: true }
  }
} satisfies Partial<ForgeConfig>;
