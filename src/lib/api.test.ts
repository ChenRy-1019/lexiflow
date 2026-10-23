/**
 * Tests for the IPC contract between the frontend and the Rust backend.
 *
 * The command names and argument shapes have to match the `#[tauri::command]`
 * functions exactly, or the app fails at runtime rather than at compile
 * time. This test pins the contract by reading the Rust source, so a rename
 * on either side breaks the build rather than the product.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUST_SOURCE = resolve(HERE, "../../src-tauri/src/lib.rs");

const rust = readFileSync(RUST_SOURCE, "utf-8");

/** The command names registered with `tauri::generate_handler!`. */
function registeredCommands(): string[] {
  const match = /generate_handler!\[([\s\S]*?)\]/.exec(rust);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The names of the `#[tauri::command]` functions defined in the source. */
function definedCommands(): string[] {
  const names: string[] = [];
  const pattern = /#\[tauri::command\][\s\S]{0,80}?fn\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rust)) !== null) {
    names.push(match[1]);
  }
  return names;
}

describe("the IPC contract", () => {
  const registered = registeredCommands();
  const defined = definedCommands();

  it("registers at least one command", () => {
    expect(registered.length).toBeGreaterThan(0);
  });

  it("only registers commands that are actually defined", () => {
    for (const name of registered) {
      expect(defined).toContain(name);
    }
  });

  it("registers every command that is defined", () => {
    for (const name of defined) {
      expect(registered).toContain(name);
    }
  });

  it("covers the commands the frontend calls", () => {
    const api = readFileSync(resolve(HERE, "api.ts"), "utf-8");
    const called = [...api.matchAll(/call<[^>]*>\(\s*"(\w+)"/g)].map((m) => m[1]);
    expect(called.length).toBeGreaterThan(10);
    for (const name of called) {
      expect(registered).toContain(name);
    }
  });
});
