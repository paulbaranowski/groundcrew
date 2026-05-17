import { base, createOxlintConfig, vitest } from "@clipboard-health/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig(
  createOxlintConfig({
    localConfig: {
      options: {
        reportUnusedDisableDirectives: "error",
        typeAware: true,
        typeCheck: true,
      },
      overrides: [
        {
          files: ["**/bin/**/*.js", "**/bin/**/*.cjs"],
          rules: {
            "typescript/no-unsafe-argument": "off",
            "typescript/no-unsafe-assignment": "off",
            "typescript/strict-boolean-expressions": "off",
          },
        },
      ],
    },
    presets: [base, vitest],
  }),
);
