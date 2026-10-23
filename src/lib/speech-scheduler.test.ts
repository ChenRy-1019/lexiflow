/**
 * Tests for the pronunciation scheduler.
 *
 * The bug these guard against: a slow download for an earlier word resolved
 * after the learner had already moved on, and its system-voice fallback spoke
 * over the next word — two voices at once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pronounceMock = vi.fn();

vi.mock("./api", () => ({
  pronounce: (...args: unknown[]) => pronounceMock(...args),
}));

/** A deferred promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("speak", () => {
  beforeEach(() => {
    pronounceMock.mockReset();
    // No speech synthesiser in the test environment, so a fallback is silent.
    delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("reports failure when there is no recording and no voice", async () => {
    pronounceMock.mockResolvedValue({ kind: "system", text: "abandon" });
    const { speak } = await import("./speech");
    expect(await speak("abandon", "us")).toBe("failed");
  });

  it("is superseded when a newer word is requested first", async () => {
    const first = deferred<{ kind: string; data?: string }>();
    const second = deferred<{ kind: string; data?: string }>();

    pronounceMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { speak } = await import("./speech");

    const firstResult = speak("abandon", "us");
    const secondResult = speak("ability", "us");

    // The newer request finishes first.
    second.resolve({ kind: "system" });
    expect(await secondResult).toBe("failed");

    // The older one arrives afterwards and must stay quiet.
    first.resolve({ kind: "system" });
    expect(await firstResult).toBe("superseded");
  });

  it("ignores an empty word", async () => {
    const { speak } = await import("./speech");
    expect(await speak("   ", "us")).toBe("failed");
    expect(pronounceMock).not.toHaveBeenCalled();
  });
});

describe("prefetch", () => {
  beforeEach(() => {
    pronounceMock.mockReset();
  });

  it("asks the backend for the recording without making a sound", async () => {
    pronounceMock.mockResolvedValue({ kind: "cached", data: "AAAA" });

    const { prefetch } = await import("./speech");
    await prefetch("abandon", "us");

    expect(pronounceMock).toHaveBeenCalledWith("abandon", "us");
  });

  it("stays quiet when the fetch fails", async () => {
    pronounceMock.mockRejectedValue(new Error("offline"));

    const { prefetch } = await import("./speech");
    await expect(prefetch("abandon", "us")).resolves.toBeUndefined();
  });
});
