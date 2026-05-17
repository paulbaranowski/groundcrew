import { createVitestConfig } from "../../vitest.shared.ts";

export default createVitestConfig({
  importMetaUrl: import.meta.url,
  name: "clearance",
  coverageExclude: ["src/cli.ts", "src/ensureCli.ts"],
});
