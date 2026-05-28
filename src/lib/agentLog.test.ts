// cspell:ignore nbbbb ncccc ghij mline -- synthetic tail fixtures (\n / SGR fused with text)
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  latestAgentLogPath,
  readFileTail,
  removeAgentLogsForTicket,
  stripAnsiEscapes,
  tailAgentLog,
} from "./agentLog.ts";
import type { ResolvedConfig } from "./config.ts";
import { writeError } from "./util.ts";

vi.mock(import("./util.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, writeError: vi.fn<typeof actual.writeError>() };
});

function makeConfig(agentLogDir: string | false): ResolvedConfig {
  return {
    sources: [],
    git: { remote: "origin", defaultBranch: "main" },
    workspace: { projectDir: "/work", knownRepositories: ["repo-a"] },
    orchestrator: {
      maximumInProgress: 4,
      pollIntervalMilliseconds: 1000,
      sessionLimitPercentage: 85,
    },
    models: { default: "claude", definitions: { claude: { cmd: "claude", color: "#fff" } } },
    prompts: { initial: "x" },
    workspaceKind: "auto",
    local: { runner: "auto" },
    logging: { file: "/tmp/groundcrew-test.log", agentLogDir },
  };
}

describe(removeAgentLogsForTicket, () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "groundcrew-removeAgentLogs-"));
    vi.mocked(writeError).mockClear();
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
    vi.mocked(writeError).mockClear();
  });

  it("removes the ticket's timestamped logs and its latest symlink", () => {
    writeFileSync(join(sandbox, "team-1-20260517-150234.log"), "a");
    writeFileSync(join(sandbox, "team-1-20260517-150300.log"), "b");
    symlinkSync("team-1-20260517-150300.log", join(sandbox, "team-1.log"));

    removeAgentLogsForTicket(makeConfig(sandbox), "team-1");

    expect(readdirSync(sandbox)).toHaveLength(0);
  });

  it("leaves other tickets' logs untouched (no prefix collision)", () => {
    writeFileSync(join(sandbox, "team-1-20260517-150234.log"), "x");
    symlinkSync("team-1-20260517-150234.log", join(sandbox, "team-1.log"));
    writeFileSync(join(sandbox, "team-10-20260517-150234.log"), "x");
    symlinkSync("team-10-20260517-150234.log", join(sandbox, "team-10.log"));
    writeFileSync(join(sandbox, "groundcrew.log"), "x");
    // Same ticket prefix but not a launch-log timestamp — leave it alone.
    writeFileSync(join(sandbox, "team-1-draft.log"), "x");

    removeAgentLogsForTicket(makeConfig(sandbox), "team-1");

    expect(readdirSync(sandbox).toSorted()).toStrictEqual(
      [
        "groundcrew.log",
        "team-1-draft.log",
        "team-10-20260517-150234.log",
        "team-10.log",
      ].toSorted(),
    );
  });

  it("does nothing when capture is disabled (agentLogDir false)", () => {
    removeAgentLogsForTicket(makeConfig(false), "team-1");

    expect(vi.mocked(writeError)).not.toHaveBeenCalled();
  });

  it("does nothing when the log directory does not exist", () => {
    removeAgentLogsForTicket(makeConfig(join(sandbox, "nope")), "team-1");

    expect(vi.mocked(writeError)).not.toHaveBeenCalled();
  });

  it("warns and continues when a matching entry cannot be removed", () => {
    writeFileSync(join(sandbox, "team-1-20260517-150234.log"), "x");
    // A non-empty directory named like a log file: rmSync (non-recursive) throws.
    const blocker = join(sandbox, "team-1-20260517-150300.log");
    mkdirSync(blocker);
    writeFileSync(join(blocker, "child"), "x");

    removeAgentLogsForTicket(makeConfig(sandbox), "team-1");

    expect(readdirSync(sandbox)).toStrictEqual(["team-1-20260517-150300.log"]);
    expect(vi.mocked(writeError)).toHaveBeenCalledTimes(1);
  });
});

describe(latestAgentLogPath, () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "groundcrew-latestAgentLog-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("returns the <ticket>.log symlink path when a captured log exists", () => {
    writeFileSync(join(sandbox, "team-1-20260517-150234.log"), "x");
    symlinkSync("team-1-20260517-150234.log", join(sandbox, "team-1.log"));

    expect(latestAgentLogPath(makeConfig(sandbox), "team-1")).toBe(join(sandbox, "team-1.log"));
  });

  it("returns undefined when no log exists for the ticket", () => {
    expect(latestAgentLogPath(makeConfig(sandbox), "team-1")).toBeUndefined();
  });

  it("returns undefined when capture is disabled", () => {
    expect(latestAgentLogPath(makeConfig(false), "team-1")).toBeUndefined();
  });
});

describe(stripAnsiEscapes, () => {
  const ESC = String.fromCodePoint(27);
  const BEL = String.fromCodePoint(7);

  it("strips SGR color codes, leaving the text", () => {
    expect(stripAnsiEscapes(`${ESC}[36m3.13.1${ESC}[39m`)).toBe("3.13.1");
  });

  it("strips CSI cursor and clear sequences", () => {
    expect(stripAnsiEscapes(`a${ESC}[2Kb${ESC}[1Ac`)).toBe("abc");
  });

  it("strips OSC sequences terminated by BEL or ST", () => {
    expect(stripAnsiEscapes(`${ESC}]0;window title${BEL}hello`)).toBe("hello");
    expect(stripAnsiEscapes(`${ESC}]8;;https://x${ESC}\\link`)).toBe("link");
  });

  it("strips carriage returns", () => {
    expect(stripAnsiEscapes("line one\r\nline two\r")).toBe("line one\nline two");
  });

  it("leaves plain text unchanged", () => {
    expect(stripAnsiEscapes("plain text 123")).toBe("plain text 123");
  });
});

describe(readFileTail, () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "groundcrew-readFileTail-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("returns the whole file when it fits within maxBytes", () => {
    const path = join(sandbox, "f.log");
    writeFileSync(path, "hello\nworld\n");

    expect(readFileTail(path, 1000)).toBe("hello\nworld\n");
  });

  it("returns trailing bytes and drops the leading partial line when larger", () => {
    const path = join(sandbox, "f.log");
    writeFileSync(path, "aaaa\nbbbb\ncccc\n"); // 15 bytes

    // Last 7 bytes are "b\ncccc\n"; the partial "b" line is dropped.
    expect(readFileTail(path, 7)).toBe("cccc\n");
  });

  it("returns the trailing bytes unchanged when they contain no newline", () => {
    const path = join(sandbox, "f.log");
    writeFileSync(path, "abcdefghij"); // 10 bytes, no newline

    expect(readFileTail(path, 4)).toBe("ghij");
  });
});

describe(tailAgentLog, () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "groundcrew-tailAgentLog-"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("returns the last N non-blank lines with escapes and CRs stripped", () => {
    const esc = String.fromCodePoint(27);
    writeFileSync(
      join(sandbox, "team-1.log"),
      `${esc}[36mline one${esc}[39m\n\nline two\r\nline three\n`,
    );

    expect(tailAgentLog(makeConfig(sandbox), "team-1", 2)).toStrictEqual([
      "line two",
      "line three",
    ]);
  });

  it("returns an empty array when no log exists for the ticket", () => {
    expect(tailAgentLog(makeConfig(sandbox), "team-1", 10)).toStrictEqual([]);
  });
});
