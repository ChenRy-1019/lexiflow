/**
 * Report CSS classes used by the components but not defined in the stylesheet.
 *
 * Usage: node scripts/audit-classes.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SRC = "src";

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const tsx = walk(SRC).filter((file) => [".tsx", ".ts"].includes(extname(file)));

const used = new Map();

for (const file of tsx) {
  const text = readFileSync(file, "utf8");

  // Static string literals: className="a b c"
  for (const match of text.matchAll(/className=(?:"([^"]*)"|'([^']*)')/g)) {
    for (const name of (match[1] ?? match[2] ?? "").split(/\s+/)) {
      if (name) used.set(name, file);
    }
  }

  // Template literals: className={`a ${cond ? "b" : "c"}`}
  for (const match of text.matchAll(/className=\{`([^`]*)`\}/g)) {
    const parts = match[1]
      .replace(/\$\{[^}]*\}/g, " ")
      .split(/\s+/);
    for (const name of parts) {
      if (name && /^[a-zA-Z][\w-]*$/.test(name)) used.set(name, file);
    }
    // Also pick quoted strings inside the interpolations.
    for (const inner of match[1].matchAll(/"([^"]+)"/g)) {
      for (const name of inner[1].split(/\s+/)) {
        if (name) used.set(name, file);
      }
    }
  }
}

const css = readFileSync("src/styles/global.css", "utf8");
const defined = new Set();
for (const match of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
  defined.add(match[1]);
}

const missing = [...used.entries()]
  .filter(([name]) => !defined.has(name))
  .sort(([a], [b]) => a.localeCompare(b));

console.log(`classes used: ${used.size}`);
console.log(`classes defined: ${defined.size}`);
console.log(`missing: ${missing.length}\n`);

for (const [name, file] of missing) {
  console.log(`  ${name}  (${file})`);
}
