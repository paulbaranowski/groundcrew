# Agent prompt: generate `.groundcrew/setup.sh`

When onboarding a new repository to groundcrew, an operator needs to author `.groundcrew/setup.sh` — the per-worktree setup hook. The hook has a non-obvious contract: the `--deps-only` branch must skip anything interactive or one-time-only, and several things that look like setup (codegen, db seeds, husky, pre-commit, local-package linking) belong only in the no-flag branch.

To hand the job to a coding agent (Claude Code, Cursor, etc.) without re-explaining the rules, open the agent at the target repo's root and paste the prompt below. For the full contract this prompt encodes, see [Per-repo setup hook](../README.md#per-repo-setup-hook) in the README.

```text
You're adding a per-worktree setup hook for this repository. Produce a single
file at `.groundcrew/setup.sh`, make it executable, and smoke-test it.

Context: groundcrew launches each agent in a fresh git worktree per ticket and
invokes `./.groundcrew/setup.sh --deps-only` before the agent starts. The flag
tells the script "you're being called by automation; skip anything interactive
or one-time-only." The same hook also runs inside the sdx sandbox.

Script requirements:

- Start with `set -euo pipefail`.
- Branch on `$1`:
  - `--deps-only` → recurring per-worktree work only (lockfile install,
    codegen the agent needs to navigate). NO prompts, NO global installs, NO
    runtime-version-manager bootstrap (`nvm`, `pyenv`, `rustup`, `mise`,
    `asdf` — assume the host has the runtime).
  - No flag → full interactive bootstrap for first-time onboarding or
    SessionStart-hook reuse (husky install, pre-commit install, db seed,
    local-package linking).
- Fast. The operator pays this cost on every ticket spinup, and each
  worktree starts fresh (`node_modules` / `.venv` / `target` are
  gitignored). Use the package manager's frozen-lockfile install (`npm
  clean-install`, `uv sync --frozen`, `cargo fetch`, etc.) and trust its
  global cache — a "fresh" install in a new worktree should resolve from
  `~/.cache/uv`, `~/.npm`, etc. rather than re-downloading. Setup failures
  are logged but don't block the agent, so exit non-zero on real problems
  so the operator sees them.

Detect this repo's stack and install accordingly. Examples:

- `package.json` + `pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` →
  matching Node package manager's frozen-lockfile install
- `pyproject.toml` + `uv.lock` → `uv sync --dev`; `poetry.lock` → poetry;
  `Pipfile.lock` → pipenv; bare `requirements.txt` → pip + venv
- `Cargo.lock` → `cargo fetch`
- `go.mod` → `go mod download`
- `Gemfile.lock` → `bundle install --jobs=4`
- Multiple lockfiles → polyglot; install each under its own guard.
- No install step (docs repo, polyglot monorepo with per-package setup) →
  emit a minimal `set -euo pipefail; exit 0` script. The explicit zero exit
  suppresses the "not configured" warning groundcrew otherwise logs.

Put codegen-the-agent-doesn't-need, db seeds, husky install, pre-commit
install, and local-package linking ONLY in the no-flag branch — never in
`--deps-only`.

Verify before reporting done:

1. `test -x .groundcrew/setup.sh` (executable bit is set).
2. `./.groundcrew/setup.sh --deps-only` exits 0 with no interactive prompts.
3. The output has no runtime-bootstrap warnings (`nvm not found`, `Python not
   on PATH`, etc.) — if you see them, the script is doing too much; strip
   those branches.

Do NOT commit. Report exactly what you wrote so the operator can review.
```
