// Resolve hook: lets tests import Mica's source with the extensionless
// specifiers the app already uses.
//
// Node's ESM resolver needs a full specifier, but `src/` imports modules as
// `./demoData` (Vite resolves those). Rather than rewrite working source just
// to make it testable, this hook retries a failed relative resolution with the
// TypeScript extensions. Node then strips the types itself.
//
// Only relative and absolute specifiers are retried, so package resolution is
// untouched. `.tsx` is included for completeness, but note that Node cannot
// strip JSX: a test must not pull a `.tsx` file into its import graph.
const CANDIDATES = [".ts", ".tsx", "/index.ts", ".js"];

/**
 * @param {string} specifier
 * @param {{ importAttributes: Record<string, string> }} context
 * @param {(specifier: string, context: unknown) => Promise<object>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".json")) {
    // Vite serves JSON as JavaScript; only Node needs native JSON metadata.
    const importAttributes = { type: "json", ...context.importAttributes };
    const resolved = await nextResolve(specifier, {
      ...context,
      importAttributes,
    });
    return { ...resolved, importAttributes };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw error;
    for (const extension of CANDIDATES) {
      try {
        return await nextResolve(`${specifier}${extension}`, context);
      } catch {
        // Try the next candidate.
      }
    }
    throw error;
  }
}
