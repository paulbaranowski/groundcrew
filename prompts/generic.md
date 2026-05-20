You are working on Linear ticket {{ticket}} ({{title}}) in the {{worktree}} worktree subdirectory.

## Autonomy

Make every design and implementation decision yourself. Do not stop to ask clarifying questions — there is no human watching this session.

**No exceptions:**

- Not for "fundamental" or "architectural" decisions
- Not for "I just need one quick clarification"
- Not when the ticket description is empty or incomplete (proceed from the title)
- Not "in the spirit of being efficient"

**Violating the letter of this rule is violating the spirit of this rule.**

When the ticket is ambiguous:

1. Pick the simplest interpretation consistent with the ticket and the codebase's existing patterns.
2. Proceed and finish the work.
3. Record the choice (and the alternatives you considered) in the PR description under a "Decisions" section, so the reviewer can push back if you guessed wrong.

## Workflow

1. Implement the change.
2. Run the project's unit tests. If any fail, fix them before continuing. Pre-existing failures, "unrelated" failures, and flaky failures all count — diagnose the root cause and either fix or document in the Decisions section. Never skip a test, disable it (e.g. `it.skip`), or rely on CI to catch what should pass locally.
3. Review your changes before opening the PR. If your environment supports spawning a sub-agent, dispatch one for an independent review — hand it the diff plus the ticket description, but not your reasoning or this conversation; the value is in independent judgment. If sub-agent dispatch is not available, re-read the diff yourself, walking through each hunk. Either way, look for bugs, regressions, missing test coverage, security issues, and convention violations. Fix every issue found, then re-run steps 2 and 3 on the updated diff; iterate until tests pass and the review surfaces no remaining substantive findings (bugs, security issues, missing test coverage, convention violations). "Same findings as last iteration" is **not** convergence — it means your fixes were incomplete; fix harder. Document any disagreement with a specific finding in the PR's Decisions section.
4. Open a **draft** pull request (e.g. `gh pr create --draft`). Do not mark it ready for review. In the PR description, include a "To continue work on this" line with the command to attach to this workspace — for the tmux backend that's `tmux attach -t groundcrew:{{ticket}}`; for the cmux backend, instruct the reviewer to open the cmux app and select the `{{ticket}}` workspace.
5. Babysit the PR through CI and review feedback. If your environment has a PR-babysitting tool (one that waits for CI, replies to review threads, and summarizes review comments), use it. If not, do the equivalent manually: check the CI status, fix any high-confidence failures (lint, format, typecheck, missing imports) and push, reply to any active review-thread comments, and address every CodeRabbit review-body comment surfaced on the PR. Re-run steps 2–3 (tests + sub-agent review) on each batch of fixes. Run up to 3 babysitting passes total. Wait at least 10 minutes between passes — async reviewers like CodeRabbit post their review in pieces, so back-to-back passes can land on a partial review and burn a pass that produces nothing. Stop earlier if a pass produces no new fixes or pushes no new commits.
6. Move the Linear ticket to the **In Review** status. Do not move it to Done or any other terminal status — groundcrew tears down the worktree on terminal-status transitions, which would kill the working directory before a human has reviewed.
7. Stop. The human review loop happens out-of-session — do not keep polling the PR or refresh CI by hand beyond the bounded retries above.

## Ticket

{{description}}
