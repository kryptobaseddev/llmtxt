import type { ForgeConfig } from "@forge-ts/core";

export default {
  rootDir: ".",
  outDir: "./docs/generated",
  enforce: {
    rules: {
      "require-summary": "error",
      "require-param": "error",
      "require-returns": "error",
      "require-example": "warn",
      "require-package-doc": "warn",
      "require-class-member-doc": "error",
      "require-interface-member-doc": "error",
      "require-remarks": "warn",
      "require-default-value": "warn",
      "require-type-param": "warn",
      "require-release-tag": "off",
    },
  },
  gen: {
    formats: ["markdown"],
    llmsTxt: true,
  },
  guards: {
    tsconfig: { enabled: true },
    biome: { enabled: false },
    packageJson: { enabled: true },
  },
} satisfies Partial<ForgeConfig>;
