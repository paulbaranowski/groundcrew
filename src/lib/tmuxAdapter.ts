/**
 * tmux Workspace backend. Workspaces live as windows inside one dedicated
 * `groundcrew` tmux session; the window name is the ticket id. tmux can't
 * paint status pills, so `open` silently drops `spec.status`. This is the
 * Linux/WSL path where cmux is unavailable.
 */

import {
  AGENT_LOG_PIPE_COMMAND,
  type PreparedAgentLog,
  prepareAgentLog,
  resolveAgentLogTarget,
} from "./agentLog.ts";
import { shellSingleQuote } from "./shell.ts";
import {
  type Adapter,
  isSignalAborted,
  type OpenSpec,
  runWorkspaceCommand,
  type Workspace,
} from "./workspaceAdapter.ts";
import { errorMessage, log, readEnvironmentVariable } from "./util.ts";

const TMUX_SESSION = "groundcrew";

// `tmux new-session -d -s …` always creates one initial window. Without
// `-n`, that window is named after the running shell (e.g. "0" / "zsh") and
// would surface from `list()` as a phantom workspace. We name it with this
// sentinel and filter it out — it stays around as a placeholder so the
// session doesn't collapse when the last ticket window closes.
const TMUX_IDLE_WINDOW = "_groundcrew_idle";

export const tmuxAdapter: Adapter = {
  async open(config, spec, signal) {
    await ensureTmuxSession(signal);
    const keepDeadWindowsEnv = readEnvironmentVariable("GROUNDCREW_KEEP_DEAD_WINDOWS");
    const keepDeadWindows = keepDeadWindowsEnv !== undefined && keepDeadWindowsEnv.length > 0;
    const agentLog = prepareAgentLog(resolveAgentLogTarget(config, spec.name), spec.command);
    await runWorkspaceCommand(
      "tmux",
      buildTmuxOpenArgv({
        sessionName: TMUX_SESSION,
        spec,
        remainOnExit: keepDeadWindows ? "on" : "off",
        agentLog,
      }),
      signal,
    );
    // tmux can't paint status pills; spec.status is silently dropped.
    return agentLog.kind === "active" ? { agentLogPath: agentLog.displayPath } : {};
  },
  async list(signal) {
    const probe = await probeTmuxList("#{window_name}\t#{pane_dead}", signal);
    if (probe.status === "missing") {
      return [];
    }
    if (probe.status === "failed") {
      log(`tmux list-windows failed: ${probe.reason}`);
      // oxlint-disable-next-line unicorn/no-useless-undefined -- undefined marks the workspace backend as unavailable.
      return undefined;
    }
    return parseTmuxWindows(probe.output);
  },
  async close(name, signal) {
    try {
      await runWorkspaceCommand("tmux", ["kill-window", "-t", tmuxTarget(name)], signal);
      return { kind: "closed" };
    } catch (error) {
      if (isSignalAborted(signal)) {
        throw error;
      }
      if (isTmuxNotFoundError(error)) {
        return { kind: "missing" };
      }
      throw error;
    }
  },
  accessHint(name) {
    return { kind: "attachCommand", command: `tmux attach -t ${tmuxTarget(name)}` };
  },
};

function tmuxTarget(name: string): string {
  return `${TMUX_SESSION}:${name}`;
}

function isTmuxNotFoundError(error: unknown): boolean {
  // runCommand surfaces the child's stderr in error.message, so the "no
  // server" / "missing session" / "can't find window" signatures are visible
  // without a separate stderr probe.
  const message = errorMessage(error);
  return (
    message.includes("no server running") ||
    message.includes("can't find session") ||
    message.includes("can't find window")
  );
}

type TmuxListProbe =
  | { status: "ok"; output: string }
  | { status: "missing" }
  | { status: "failed"; reason: string };

async function probeTmuxList(format: string, signal?: AbortSignal): Promise<TmuxListProbe> {
  try {
    return {
      status: "ok",
      output: await runWorkspaceCommand(
        "tmux",
        ["list-windows", "-t", TMUX_SESSION, "-F", format],
        signal,
      ),
    };
  } catch (error) {
    if (isSignalAborted(signal)) {
      throw error;
    }
    if (isTmuxNotFoundError(error)) {
      return { status: "missing" };
    }
    return { status: "failed", reason: errorMessage(error) };
  }
}

async function ensureTmuxSession(signal?: AbortSignal): Promise<void> {
  try {
    await runWorkspaceCommand("tmux", ["has-session", "-t", TMUX_SESSION], signal);
    return;
  } catch (error) {
    if (isSignalAborted(signal)) {
      throw error;
    }
    /* session missing or server down; create it */
  }
  try {
    await runWorkspaceCommand(
      "tmux",
      ["new-session", "-d", "-s", TMUX_SESSION, "-n", TMUX_IDLE_WINDOW],
      signal,
    );
  } catch (error) {
    if (isSignalAborted(signal)) {
      throw error;
    }
    try {
      await runWorkspaceCommand("tmux", ["has-session", "-t", TMUX_SESSION], signal);
    } catch {
      throw error;
    }
  }
}

function parseTmuxWindows(output: string): Workspace[] {
  const items: Workspace[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const [name, deadFlag] = line.split("\t");
    /* v8 ignore next 3 @preserve -- split on a non-empty string always yields a non-empty first element */
    if (name === undefined || name.length === 0) {
      continue;
    }
    if (name === TMUX_IDLE_WINDOW) {
      continue;
    }
    // pane_dead != 0 means the command exited and the window is a zombie
    // (only happens when remain-on-exit is on; defense in depth in case a
    // user-globally-set value beats our per-window override).
    if (deadFlag !== undefined && deadFlag !== "0") {
      continue;
    }
    items.push({ name });
  }
  return items;
}

/**
 * Build the argv for the atomic tmux `new-window … ; set-window-option … ; …`
 * chain that opens a workspace window. Pure function — extracted from
 * `tmuxAdapter.open` so the integration test can drive it with a sandbox
 * session name. No tmux process is invoked here.
 *
 * @param arguments_.agentLog - `{ kind: "active", logPath }` appends a
 *   `pipe-pane -o -t <target> '<AGENT_LOG_PIPE_COMMAND> >> <logPath>'`
 *   chunk that timestamps every captured line with HH:MM:SS (local time).
 *   `{ kind: "disabled" }` omits the chunk entirely.
 */
export function buildTmuxOpenArgv(arguments_: {
  sessionName: string;
  spec: OpenSpec;
  remainOnExit: "on" | "off";
  agentLog: PreparedAgentLog;
}): string[] {
  const target = `${arguments_.sessionName}:${arguments_.spec.name}`;
  const argv: string[] = [
    "new-window",
    "-d",
    "-t",
    arguments_.sessionName,
    "-n",
    arguments_.spec.name,
    "-c",
    arguments_.spec.cwd,
    arguments_.spec.command,
    ";",
    "set-window-option",
    "-t",
    target,
    "remain-on-exit",
    arguments_.remainOnExit,
    ";",
    "set-window-option",
    "-t",
    target,
    "allow-rename",
    "off",
  ];
  if (arguments_.agentLog.kind === "active") {
    argv.push(
      ";",
      "pipe-pane",
      "-o",
      "-t",
      target,
      `${AGENT_LOG_PIPE_COMMAND} >> ${shellSingleQuote(arguments_.agentLog.logPath)}`,
    );
  }
  return argv;
}
