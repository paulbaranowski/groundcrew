# Configuration

Two keys are required; everything else has a default.

| Key                           | What                                                                   |
| ----------------------------- | ---------------------------------------------------------------------- |
| `workspace.projectDir`        | Parent dir for cloned repos and sibling ticket worktrees.              |
| `workspace.knownRepositories` | Repos searched for in ticket descriptions to infer where work belongs. |

The branch prefix (`<prefix>-<TICKET>`) is derived from `os.userInfo().username` and is not configurable. There is no `linear` config block. Groundcrew picks up every issue assigned to your API key's viewer that carries an `agent-*` label across every visible team and project, governed by a single `orchestrator.maximumInProgress` budget.

## Repository Layout

Groundcrew never clones repositories for you. `crew init --repo OWNER/REPO` prints the clone command to run. If you are cloning manually, clone each `workspace.knownRepositories` entry into `workspace.projectDir` using the same relative path the config uses.

```bash
PROJECT_DIR="$HOME/dev"
mkdir -p "$PROJECT_DIR/OWNER"
git clone git@github.com:OWNER/REPO.git "$PROJECT_DIR/OWNER/REPO"
```

Bare-name entries have no owner, so pick the remote URL yourself and clone to `$PROJECT_DIR/<name>`.

## Scripted Worktrees (Sparse Checkouts)

A `workspace.knownRepositories` entry can be an **object** instead of a string when you want groundcrew to provision the worktree with a custom command — for example a sparse checkout via `graft` — instead of `git worktree add`:

```ts
workspace: {
  projectDir: "~/dev/groundcrew",
  knownRepositories: [
    "your-org/your-repo",
    {
      repo: "billing",
      create: "graft new ${branch} billing --from ${baseRef} --dir ${dir}",
      remove: "graft rm ${branch} -f",
    },
  ],
},
```

- **`repo`** is a logical name — it is the token matched in ticket descriptions and the basename of the per-ticket worktree directory. The physical clone is the command's concern, so several scripted entries can share one underlying clone.
- **`create`** runs in place of `git worktree add`; **`remove`** runs in place of `git worktree remove`. You must define **both or neither** — a half-scripted entry is rejected at config load.
- Both templates run on the host via `sh -c` with the working directory set to `workspace.projectDir`. They interpolate `${branch}`, `${dir}`, `${baseRef}` (`<remote>/<defaultBranch>`), `${repo}`, and `${ticket}`; each value is shell-quoted.
- A dirty scripted worktree is still protected from data loss: `crew cleanup` refuses to run `remove` unless you pass `--force`. Orphan and branch cleanup are delegated to your `remove` template, since groundcrew does not track the scripted clone.

Set `graft` (or whatever tool your templates call) up once, outside groundcrew:

```bash
graft repo add ~/dev/owner/monorepo
graft alias add billing services/billing libs/common
```

`crew doctor` then verifies the first token of each `create` template (e.g. `graft`) is on the host PATH.

## Config Discovery

Resolution order:

1. `GROUNDCREW_CONFIG`
2. cosmiconfig project-walk from cwd
3. `${XDG_CONFIG_HOME:-$HOME/.config}/groundcrew/crew.config.ts`

The project walk checks:

- `crew.config.{ts,mjs,js,json}`
- `.crewrc{,.json,.ts}`
- `.config/crew.config.{ts,json}`
- `.config/crewrc{,.json}`

The "Loaded config from ..." line at startup tells you which config won.

## Agent Label Routing

- `agent-claude`, `agent-codex`, `agent-<name>` routes to that model.
- `agent-any` routes to the model with the most available session capacity.
- Unknown `agent-<name>` falls back to `models.default` with a warning.
- No `agent-*` label is ignored by `crew run`. Dispatch on demand with `crew start <TICKET>`, which falls back to `models.default`.
- Todo tickets blocked by non-terminal blockers are skipped until their blockers reach a terminal status.

Status classification uses Linear's workflow `state.type` (`unstarted`, `started`, `completed`, `canceled`, `duplicate`), so renamed status columns work without configuration. Parent issues with children are ignored; sub-issues are the work items.

## Disabling A Shipped Default Model

Groundcrew ships `claude` and `codex` as default model definitions, additively merged into every resolved config. To stop probing one:

```ts
export default {
  models: {
    default: "claude",
    definitions: {
      codex: { disabled: true },
    },
  },
};
```

Effects:

- `crew doctor` does not probe the disabled model's CLI.
- `agent-any` only resolves to enabled models.
- An `agent-<disabled>` label on a ticket falls back to `models.default` with a warning in the log.

Rules:

- `disabled` only accepts shipped-default keys (`claude`, `codex`). A typo fails loudly at config load.
- `disabled` must be exactly the boolean `true`.
- It cannot be combined with `cmd`, `color`, or `usage` in the same entry.
- `models.default` must point at an enabled model.

## Prompt Customization

Groundcrew ships one model-agnostic unattended prompt by default. It tells the agent to make reasonable assumptions, follow repository instructions, run documented verification, review its diff, open a PR when GitHub/`gh` is available, and include a workspace continuation hint when known.

For a personal workflow, keep the prompt next to your local config and load it with `readFileSync`:

```ts
import { readFileSync } from "node:fs";

export default {
  prompts: {
    initial: readFileSync(new URL("./initial-prompt.md", import.meta.url), "utf8"),
  },
};
```

This keeps package defaults portable while letting your private config reference team-specific statuses, tools, plugins, or review loops.

## Full Reference

| Key                                      | Default             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources`                                | `[]`                | Additional pluggable ticket sources, dispatched alongside the built-in Linear adapter. Built-in kinds: `shell`, `linear`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `git.remote`                             | `"origin"`          | Remote used for `fetch` and as the worktree base ref.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `git.defaultBranch`                      | `"main"`            | Branch fetched from `git.remote` and used as the worktree base.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `workspace.projectDir`                   | **required**        | Parent dir for cloned repos and sibling ticket worktrees.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `workspace.knownRepositories`            | **required**        | Repos searched for in ticket descriptions to infer where work belongs. A ticket labeled for groundcrew (`agent-*`) fails fast when no known repo appears; unlabeled tickets are ignored.                                                                                                                                                                                                                                                                                                                                    |
| `orchestrator.maximumInProgress`         | `4`                 | Cap on in-progress tickets at once for this `crew` instance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `orchestrator.pollIntervalMilliseconds`  | `120_000`           | Poll interval in `--watch` mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `orchestrator.sessionLimitPercentage`    | `85`                | Number in `(0, 100]`. A model whose codexbar session window exceeds this percentage is skipped that tick.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `models.default`                         | `"claude"`          | Tiebreak for `agent-any` resolution and fallback for explicit but unknown `agent-*` labels. Also used by `crew start <TICKET>` for unlabeled tickets. `crew run` ignores unlabeled tickets and does not apply this default. Must exist in `models.definitions`.                                                                                                                                                                                                                                                             |
| `models.definitions`                     | `{ claude, codex }` | Agent definitions. Additive merge with shipped defaults.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `models.definitions.<name>.cmd`          | —                   | Shell command launched for the model. Runs in the worktree through the resolved `local.runner`. `{{worktree}}` is replaced before launch; `{{sandbox}}` expands to the sbx sandbox name under the sdx runner and an empty string otherwise.                                                                                                                                                                                                                                                                                 |
| `models.definitions.<name>.color`        | —                   | Color for the workspace status pill (cmux only; tmux silently drops it).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `models.definitions.<name>.usage`        | optional            | If set, codexbar usage is fetched for this model and gated by `sessionLimitPercentage`. Falls back to default when unset, with gating enabled for known models. When `usage.codexbar.source` is omitted, groundcrew uses `oauth` for Codex/Claude on macOS, `auto` for other macOS providers, and `cli` elsewhere. Set to `{ disabled: true }` to disable usage gating.                                                                                                                                                     |
| `models.definitions.<name>.sandbox`      | optional            | Docker Sandboxes binding for the model. Required at launch when `local.runner` resolves to `sdx`. Fields: `agent` (required sbx agent name) and `setupCommand` (override for the inside-sandbox setup script). Groundcrew assumes the `groundcrew-<agent>` sandbox already exists.                                                                                                                                                                                                                                          |
| `models.definitions.<name>.preLaunch`    | optional            | Host-only shell snippet run before the agent exec and outside Safehouse/sdx. Exports survive into the launch shell; under the default `safehouse` runner they are only forwarded to the agent when listed via `preLaunchEnv` or when `cmd` includes its own `safehouse --env-pass=NAMES`. `{{worktree}}` is substituted. A non-zero exit aborts launch. Not supported when `local.runner` resolves to `sdx` in v1.                                                                                                          |
| `models.definitions.<name>.preLaunchEnv` | optional            | Companion to `preLaunch`: list of env var names to append to groundcrew's `safehouse-clearance` `--env-pass=` flag, so `preLaunch` exports reach the agent without overriding `cmd` and losing the project's egress allowlist. Each entry must match `[A-Za-z_][A-Za-z0-9_]*`. Under `runner: "none"` exports already inherit and `preLaunchEnv` is a no-op. An empty array is a uniform no-op in every runner; a non-empty list is rejected when `cmd` already starts with `safehouse` or when `runner` resolves to `sdx`. |
| `models.definitions.<name>.disabled`     | optional            | When set to exactly `true`, drops the named shipped default (`claude` or `codex`). Doctor skips probing it; `agent-<name>` labels fall back to `models.default` with a warning.                                                                                                                                                                                                                                                                                                                                             |
| `prompts.initial`                        | unattended template | First message sent to the agent. Placeholders: `{{ticket}}`, `{{worktree}}`, `{{title}}`, `{{description}}`. Override this from `crew.config.ts` for team-specific statuses, tools, plugins, or review loops.                                                                                                                                                                                                                                                                                                               |
| `workspaceKind`                          | `"auto"`            | Terminal session manager. `"auto"` picks `cmux` when on PATH, else `tmux`. Set to `"cmux"` or `"tmux"` to fail loudly when the chosen backend is missing.                                                                                                                                                                                                                                                                                                                                                                   |
| `local.runner`                           | `"auto"`            | Local isolation backend. `"auto"` uses `safehouse` on macOS and `sdx` on Linux/WSL. Explicit: `"safehouse"`, `"sdx"`, `"none"`. `"none"` is never picked implicitly.                                                                                                                                                                                                                                                                                                                                                        |
| `logging.file`                           | XDG state path      | Append-mode log file. `log()` / `logEvent()` tee here in addition to stdout. Defaults to `${XDG_STATE_HOME:-$HOME/.local/state}/groundcrew/groundcrew.log`.                                                                                                                                                                                                                                                                                                                                                                 |
