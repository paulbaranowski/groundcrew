/**
 * Per-launch agent log files: where they live (`resolveAgentLogTarget`), how
 * they are created (`prepareAgentLog`), and the pipe-pane sink that fills them
 * (`AGENT_LOG_PIPE_COMMAND`). The tmux adapter is the only writer today, but
 * these concerns are backend-agnostic and have non-adapter consumers (cleanup),
 * so they live here rather than in `tmuxAdapter.ts`.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

import type { ResolvedConfig } from "./config.ts";
import { errorMessage, writeError } from "./util.ts";

export type AgentLogTarget =
  | { kind: "disabled" }
  | { kind: "active"; logPath: string; latestSymlink: string };

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtcStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${padTwo(date.getUTCMonth() + 1)}${padTwo(date.getUTCDate())}` +
    `-${padTwo(date.getUTCHours())}${padTwo(date.getUTCMinutes())}${padTwo(date.getUTCSeconds())}`
  );
}

/**
 * Pure: resolves where a per-launch agent log would live. Does not touch
 * the filesystem. `prepareAgentLog` does that.
 */
export function resolveAgentLogTarget(config: ResolvedConfig, ticketName: string): AgentLogTarget {
  if (config.logging.agentLogDir === false) {
    return { kind: "disabled" };
  }
  const stamp = formatUtcStamp(new Date());
  const logPath = resolve(config.logging.agentLogDir, `${ticketName}-${stamp}.log`);
  const latestSymlink = resolve(config.logging.agentLogDir, `${ticketName}.log`);
  return { kind: "active", logPath, latestSymlink };
}

const HEADER_COMMAND_MAX_LENGTH = 120;

function renderHeaderLine(ticketName: string, command: string): string {
  const summary = command.replaceAll(/\s+/g, " ").slice(0, HEADER_COMMAND_MAX_LENGTH);
  return `[groundcrew] ${ticketName} launch at ${new Date().toISOString()} backend=tmux command=${summary}\n`;
}

/**
 * Atomically point `linkPath` at `targetBasename` by creating a fresh
 * symlink at `linkPath.tmp` and renaming over `linkPath`. Throws if the
 * filesystem doesn't support symlinks; caller decides whether to fail
 * or continue without the convenience symlink.
 */
function atomicSymlink(linkPath: string, targetBasename: string): void {
  const tmpPath = `${linkPath}.tmp`;
  try {
    unlinkSync(tmpPath);
  } catch {
    // Tmp file didn't exist — normal case.
  }
  symlinkSync(targetBasename, tmpPath);
  renameSync(tmpPath, linkPath);
}

export type PreparedAgentLog =
  | { kind: "disabled" }
  | {
      kind: "active";
      /** Path pipe-pane writes to (always the timestamped file). */
      logPath: string;
      /**
       * Path to advertise to the user. Equals `latestSymlink` when the
       * symlink was refreshed successfully, otherwise falls back to
       * `logPath` so the user gets a path that actually exists.
       */
      displayPath: string;
    };

/**
 * Performs the filesystem side of agent-log setup: mkdir the directory,
 * write a one-line header to the timestamped log, refresh the
 * `<ticket>.log` symlink atomically. Soft-fails: on any mkdir/write
 * error the function returns `{ kind: "disabled" }` so the caller can
 * skip the pipe-pane chunk without aborting the workspace open.
 *
 * @param target  - From `resolveAgentLogTarget`.
 * @param command - The `OpenSpec.command` string, used only for the
 *                  header summary (truncated to 120 chars).
 */
export function prepareAgentLog(target: AgentLogTarget, command: string): PreparedAgentLog {
  if (target.kind === "disabled") {
    return { kind: "disabled" };
  }
  const ticketName = basename(target.latestSymlink, ".log");
  try {
    mkdirSync(dirname(target.logPath), { recursive: true });
    writeFileSync(target.logPath, renderHeaderLine(ticketName, command));
  } catch (error) {
    writeError(
      `groundcrew: disabling agent log capture for ${ticketName} — ${errorMessage(error)}`,
    );
    return { kind: "disabled" };
  }
  let displayPath = target.latestSymlink;
  try {
    atomicSymlink(target.latestSymlink, basename(target.logPath));
  } catch (error) {
    writeError(
      `groundcrew: could not refresh ${ticketName}.log symlink — ${errorMessage(error)}. ` +
        `Capture still active at ${target.logPath}.`,
    );
    // Symlink failure does NOT disable capture; advertise the
    // timestamped file directly so the user doesn't follow a
    // missing symlink.
    displayPath = target.logPath;
  }
  return { kind: "active", logPath: target.logPath, displayPath };
}

/**
 * Shell command used as the pipe-pane sink to capture pane output into
 * the per-launch agent log file. Each captured line is prefixed with a
 * local-time `HH:MM:SS ` stamp. `BEGIN { $|=1 }` is perl's autoflush so
 * lines land in the file as they arrive, not just on perl exit.
 *
 * Why perl: macOS's BSD `/usr/bin/awk` lacks `strftime` (a gawk
 * extension); `/usr/bin/perl` is in both macOS base and every Linux
 * distro groundcrew targets, so this is the universal choice with no
 * new dependency. If `/usr/bin/perl` is somehow absent, pipe-pane's
 * child dies on first output and the log stays empty — accept that
 * failure mode for now.
 */
export const AGENT_LOG_PIPE_COMMAND = `perl -ne 'BEGIN { $|=1; use POSIX qw(strftime) } print strftime("%H:%M:%S", localtime), " ", $_'`;

/**
 * Does `name` belong to `ticket`'s per-launch logs? Matches the `<ticket>.log`
 * symlink and `<ticket>-<UTC-timestamp>.log` files. The timestamp anchor keeps
 * a prefix like `team-1` from matching `team-10`'s files, and leaves unrelated
 * `<ticket>-*.log` files (no valid timestamp) untouched.
 */
function isAgentLogForTicket(name: string, ticket: string): boolean {
  if (name === `${ticket}.log`) {
    return true;
  }
  if (!name.startsWith(`${ticket}-`) || !name.endsWith(".log")) {
    return false;
  }
  const stamp = name.slice(ticket.length + 1, -".log".length);
  return /^\d{8}-\d{6}$/.test(stamp);
}

/**
 * Path of the `<ticket>.log` symlink (the always-latest pointer) when capture
 * is enabled and a log for the ticket exists on disk, else `undefined`. Used to
 * surface a ready-to-open path in `crew status`. A disabled dir or a missing /
 * dangling symlink yields `undefined` so callers never advertise a dead path.
 */
export function latestAgentLogPath(config: ResolvedConfig, ticket: string): string | undefined {
  if (config.logging.agentLogDir === false) {
    return undefined;
  }
  const latestSymlink = resolve(config.logging.agentLogDir, `${ticket}.log`);
  return existsSync(latestSymlink) ? latestSymlink : undefined;
}

/**
 * Best-effort removal of a ticket's per-launch agent logs from the configured
 * agent log dir, called when its workspace is torn down. Never throws: a
 * disabled/missing dir is a no-op, and a file that won't delete warns and is
 * skipped so the rest of cleanup still completes.
 */
export function removeAgentLogsForTicket(config: ResolvedConfig, ticket: string): void {
  const dir = config.logging.agentLogDir;
  if (dir === false || !existsSync(dir)) {
    return;
  }
  for (const name of readdirSync(dir)) {
    if (!isAgentLogForTicket(name, ticket)) {
      continue;
    }
    try {
      rmSync(resolve(dir, name));
    } catch (error) {
      writeError(
        `groundcrew: could not remove agent log ${name} for ${ticket} — ${errorMessage(error)}`,
      );
    }
  }
}

const ANSI_ESC = String.fromCodePoint(27); // ESC
const ANSI_BEL = String.fromCodePoint(7); // BEL

// Built from char codes (not a literal) so the source carries no raw control
// bytes and oxlint's no-control-regex stays quiet. Matches, in order:
//   - OSC: ESC ] ... terminated by BEL or ST (ESC \)
//   - CSI: ESC [ <params> <intermediates> <final>  (SGR color, cursor, clear, …)
//   - two-byte escapes: ESC <@-_>
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${ANSI_ESC}\\][^${ANSI_BEL}${ANSI_ESC}]*(?:${ANSI_BEL}|${ANSI_ESC}\\\\)` +
    `|${ANSI_ESC}\\[[0-?]*[ -/]*[@-~]` +
    `|${ANSI_ESC}[@-_]`,
  "g",
);

/**
 * Remove ANSI/terminal escape sequences and carriage returns from text, leaving
 * the readable plain-text content. Used to render a captured agent log (which is
 * a raw terminal stream) inside `crew status` without garbling the output.
 */
export function stripAnsiEscapes(text: string): string {
  return text.replaceAll(ANSI_ESCAPE_PATTERN, "").replaceAll("\r", "");
}

/**
 * Read up to the last `maxBytes` of a file. Returns the whole file when it fits;
 * otherwise reads the trailing window and drops the leading (likely partial)
 * line so callers always get whole lines. Avoids slurping a large, long-running
 * agent log into memory just to show its tail.
 */
export function readFileTail(path: string, maxBytes: number): string {
  const { size } = statSync(path);
  if (size <= maxBytes) {
    return readFileSync(path, "utf8");
  }
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, size - maxBytes);
    const text = buffer.toString("utf8", 0, bytesRead);
    const firstNewline = text.indexOf("\n");
    return firstNewline === -1 ? text : text.slice(firstNewline + 1);
  } finally {
    closeSync(fd);
  }
}

const AGENT_LOG_TAIL_MAX_BYTES = 64 * 1024;

/**
 * Last `maxLines` non-blank lines of a ticket's latest agent log, with terminal
 * escape sequences stripped to plain text. Returns `[]` when capture is disabled
 * or no log exists. Reads only the trailing window of the file.
 */
export function tailAgentLog(
  config: ResolvedConfig,
  ticket: string,
  maxLines: number,
): readonly string[] {
  const path = latestAgentLogPath(config, ticket);
  if (path === undefined) {
    return [];
  }
  const lines = stripAnsiEscapes(readFileTail(path, AGENT_LOG_TAIL_MAX_BYTES))
    .split("\n")
    .filter((line) => line.trim().length > 0);
  return lines.slice(-maxLines);
}
