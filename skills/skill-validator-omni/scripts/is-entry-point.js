/**
 * Whether this file is the process entry point.
 *
 * A name or URL-string comparison is not enough. Through a bin shim — `npx`, `npm i -g`, a linked
 * install — `argv[1]` is a symlink whose basename is the *command*, while the module itself
 * resolves to `validate.js`. The check comes back false, the CLI exits `0`, and it prints nothing:
 * a silent no-op that reads as success.
 *
 * The hand-built form `new URL(\`file://${process.argv[1]}\`)` is worse: it compares strings the OS
 * is free to case or normalise differently (a Windows drive letter, a path with spaces), so even a
 * direct invocation can fail to match.
 *
 * Compare real paths instead: `realpathSync` on both sides, with the module URL turned into a path
 * by `fileURLToPath`. Both sides agree whether the process started as `node src/validate.js`,
 * through a symlink, or through a Windows `.cmd` shim.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const isEntryPoint = (importMetaUrl) => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    // A path that cannot be resolved is not this file.
    return false;
  }
};
