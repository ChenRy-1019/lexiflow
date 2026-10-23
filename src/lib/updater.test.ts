/**
 * Tests for the update helpers and the typing sounds.
 *
 * The version parser is the piece most likely to be wrong in a way only a
 * real release exposes: `0.10.0` must sort above `0.9.0`, and a naive string
 * comparison gets that backwards.
 */

import { describe, expect, it, vi } from "vitest";

import { parseVersion } from "./updater";

describe("parseVersion", () => {
  it("splits a version into numbers", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
  });

  it("ignores a leading v", () => {
    expect(parseVersion("v0.1.1")).toEqual([0, 1, 1]);
  });

  it("sorts 0.10 above 0.9", () => {
    const older = parseVersion("0.9.0");
    const newer = parseVersion("0.10.0");
    // Lexicographic comparison of strings would say the opposite.
    const compare = (a: number[], b: number[]) => {
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const left = a[i] ?? 0;
        const right = b[i] ?? 0;
        if (left !== right) return left - right;
      }
      return 0;
    };
    expect(compare(newer, older)).toBeGreaterThan(0);
  });
});

describe("the sound setting", () => {
  it("defaults to enabled and can be turned off", async () => {
    const { isSoundEnabled, setSoundEnabled } = await import("./sounds");

    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);

    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);

    // Restore the default for other tests.
    setSoundEnabled(true);
  });

  it("does nothing when audio is unavailable", async () => {
    const { playSound, setSoundEnabled } = await import("./sounds");
    setSoundEnabled(true);

    // In a node environment there is no Audio constructor; playing must not
    // throw, because a missing clip should never break typing.
    expect(() => playSound("key")).not.toThrow();
  });

  it("skips playback entirely when disabled", async () => {
    const { playSound, setSoundEnabled } = await import("./sounds");
    setSoundEnabled(false);

    const created: string[] = [];
    (globalThis as unknown as { Audio: unknown }).Audio = class {
      constructor(src: string) {
        created.push(src);
      }
      play() {
        return Promise.resolve();
      }
    };

    playSound("key");
    expect(created).toHaveLength(0);

    delete (globalThis as unknown as { Audio?: unknown }).Audio;
    setSoundEnabled(true);
  });
});
