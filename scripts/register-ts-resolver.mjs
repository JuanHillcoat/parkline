/**
 * Lets `node` run scripts that import `src/` code written with extensionless
 * relative imports (the form bundlers and TypeScript accept): it retries the
 * specifier with a `.ts` extension. Loaded with `--import`.
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    if (relative && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
