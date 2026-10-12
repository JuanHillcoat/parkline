/**
 * Import resolver for in-memory lint fixtures: resolves relative imports to a
 * `.ts` path without touching the file system, so fixtures need no real files.
 */
const path = require("node:path");

exports.interfaceVersion = 2;

exports.resolve = (source, file) => {
  if (!source.startsWith(".")) return { found: false };
  const resolved = path.resolve(path.dirname(file), source);
  return { found: true, path: `${resolved}.ts` };
};
