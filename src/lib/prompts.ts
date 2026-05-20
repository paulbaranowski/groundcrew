/**
 * Per-agent default prompts shipped with groundcrew, plus the resolution
 * helper that picks the right one at dispatch time.
 *
 * Resolution order (`resolvePromptForModel`):
 *   1. `config.prompts.initial` (the user's global override) — if set.
 *   2. `DEFAULT_PROMPTS_BY_MODEL[model]` — the shipped per-agent default.
 *   3. `GENERIC_DEFAULT_PROMPT` — qualifier-wrapped fallback for custom
 *      models groundcrew doesn't ship a tuned default for.
 *
 * Prompt content lives in `prompts/*.md` at the package root so it's
 * editable as plain Markdown — easy to read on GitHub, easy to diff
 * when the workflow evolves. The README links readers directly to those
 * files rather than to these TypeScript constants.
 *
 * All three default prompts hard-code "In Review" as the post-PR Linear
 * status. Teams using a different status name should override via
 * `config.prompts.initial` (applies to every model).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ResolvedConfig } from "./config.ts";

// `import.meta.dirname` is `<package>/src/lib` in source and
// `<package>/dist/lib` in the built artifact. In both layouts the
// shipped `prompts/` directory sits two levels up at the package root.
// Matches the `PACKAGE_CONFIG_PATH` trick in `config.ts`.
const PROMPTS_DIR = resolve(import.meta.dirname, "..", "..", "prompts");

function loadPrompt(name: string): string {
  return readFileSync(resolve(PROMPTS_DIR, `${name}.md`), "utf8");
}

/**
 * Default prompt for the `claude` model. Source: `prompts/claude.md`.
 *
 * Assumes Claude Code's `Task` tool for sub-agent dispatch is available,
 * and *recommends* the `superpowers:using-superpowers` skill from the
 * wild-horses marketplace. If `superpowers` is not installed, Claude
 * Code will report the skill as missing and continue — the prompt is
 * still serviceable, just without the planning/TDD discipline overlay.
 */
export const CLAUDE_DEFAULT_PROMPT = loadPrompt("claude");

/**
 * Default prompt for the `codex` model. Source: `prompts/codex.md`.
 *
 * Same shape as `prompts/claude.md` except for the omitted
 * `superpowers:using-superpowers` invocation — Claude Code skills do
 * not apply to Codex.
 */
export const CODEX_DEFAULT_PROMPT = loadPrompt("codex");

/**
 * Fallback prompt for custom models groundcrew doesn't ship a default
 * for (e.g., `cursor` added via `models.definitions.cursor`). Source:
 * `prompts/generic.md`. Uses "if available" qualifiers around sub-agent
 * dispatch since we can't assume that capability outside Claude Code /
 * Codex.
 */
export const GENERIC_DEFAULT_PROMPT = loadPrompt("generic");

/**
 * Map from model name to its shipped default prompt. Consulted by
 * `resolvePromptForModel` after the user's global `prompts.initial`
 * override is checked. Models not in this map fall back to
 * `GENERIC_DEFAULT_PROMPT`.
 */
export const DEFAULT_PROMPTS_BY_MODEL: Readonly<Record<string, string>> = {
  claude: CLAUDE_DEFAULT_PROMPT,
  codex: CODEX_DEFAULT_PROMPT,
};

/**
 * Pick the prompt to render for `modelName`. User-set `prompts.initial`
 * wins unconditionally (legacy behavior); otherwise the shipped per-model
 * default is used; otherwise the generic fallback.
 */
export function resolvePromptForModel(
  config: Pick<ResolvedConfig, "prompts">,
  modelName: string,
): string {
  if (config.prompts.initial !== undefined) {
    return config.prompts.initial;
  }
  return DEFAULT_PROMPTS_BY_MODEL[modelName] ?? GENERIC_DEFAULT_PROMPT;
}
