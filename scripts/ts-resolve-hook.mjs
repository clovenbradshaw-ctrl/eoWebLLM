// A minimal ESM resolve hook so `node --test` can run app source files
// directly: Next.js/webpack resolve extensionless relative specifiers
// (`./eo-citation-check`) fine, but Node's own resolver does not. Rather
// than add an explicit ".ts" extension to every cross-module import in app
// source (which breaks tsc — see TS5097, extensions are only importable
// with `allowImportingTsExtensions`), this retries a failed relative
// resolution with ".ts" appended, so app files can be unit-tested as-is.
// Tried second, only if ".ts" also fails to resolve — app source freely
// mixes .ts and plain .js siblings (e.g. eo-hypergraph.ts imports
// ./eo-self-facts, which is a real .js file, not a missing .ts one), and a
// module under test can transitively import either kind without knowing
// which.
const EXTENSIONS = [".ts", ".js"];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
      for (const ext of EXTENSIONS) {
        try {
          return await nextResolve(`${specifier}${ext}`, context);
        } catch {
          // try the next extension
        }
      }
    }
    throw err;
  }
}
