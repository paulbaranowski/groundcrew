import { removeAgentLogsForTicket } from "./agentLog.ts";
import type { ResolvedConfig } from "./config.ts";
import { removeRunState } from "./runState.ts";
import { errorMessage, log } from "./util.ts";
import type { WorktreeEntry } from "./worktrees.ts";

/**
 * Remove the per-ticket artifacts left behind by worktrees that were torn down:
 * the run-state record and any captured agent logs. Both steps are best-effort
 * and independent — a run-state failure is logged and does not block log
 * removal, and log removal never throws.
 */
export function cleanUpRemovedTickets(
  config: ResolvedConfig,
  entries: readonly WorktreeEntry[],
): void {
  for (const entry of entries) {
    try {
      removeRunState(config, entry.ticket);
    } catch (error) {
      log(`Run state cleanup failed for ${entry.ticket}: ${errorMessage(error)}`);
    }
    removeAgentLogsForTicket(config, entry.ticket);
  }
}
