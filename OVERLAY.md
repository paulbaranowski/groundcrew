## Project-specific rules

### Development workflow

1. Use red, green, refactor test-driven development
2. Validate changes with at least `node --run verify`
3. Invoke core:go skill for ALL code changes

### Vitest coverage ignores

Vitest uses V8 coverage through Vite/esbuild. Plain coverage comments are stripped before coverage remapping, so use legal preserved hints:

- `/* v8 ignore next @preserve */` for genuinely unreachable statements/functions
- `/* v8 ignore else @preserve */` before an `if` when only the else branch is unreachable

Prefer tests or restructuring over ignores when the path is reachable.
