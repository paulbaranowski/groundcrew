#!/usr/bin/env node

import { startClearanceFromEnv } from "./index.ts";

startClearanceFromEnv({ env: readProcessEnvironment() }).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
});

function readProcessEnvironment(): NodeJS.ProcessEnv {
  // oxlint-disable-next-line node/no-process-env -- CLI entrypoint passes the process environment into the pure startup path.
  return process.env;
}
