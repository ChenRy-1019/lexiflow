/**
 * Tests for the speech helpers.
 *
 * The functions are pure apart from the browser APIs, so they can be tested
 * with a stubbed `speechSynthesis`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { findSystemVoice, type Accent } from "./speech";

/** A stand-in for a browser voice. */
interface FakeVoice {
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
  voiceURI: string;
}

/** Install a fake `speechSynthesis` on the global object. */
function installVoices(voices: FakeVoice[]): void {
  (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    getVoices: () => voices,
    cancel: () => undefined,
    speak: () => undefined,
    addEventListener: () => undefined,
  };
}

function removeVoices(): void {
  delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
}

describe("findSystemVoice", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    removeVoices();
  });

  it("returns null when the browser has no speech synthesis", () => {
    removeVoices();
    expect(findSystemVoice("us")).toBeNull();
  });

  it("returns null when no voice is installed", () => {
    installVoices([]);
    expect(findSystemVoice("us")).toBeNull();
  });

  it("picks the American voice for the American accent", () => {
    installVoices([
      { name: "Microsoft Hazel Desktop", lang: "en-GB", default: false, localService: true, voiceURI: "x" },
      { name: "Microsoft Zira Desktop", lang: "en-US", default: true, localService: true, voiceURI: "y" },
    ]);
    const voice = findSystemVoice("us");
    expect(voice?.name).toBe("Microsoft Zira Desktop");
    expect(voice?.lang).toBe("en-US");
  });

  it("picks the British voice for the British accent", () => {
    installVoices([
      { name: "Microsoft Zira Desktop", lang: "en-US", default: true, localService: true, voiceURI: "y" },
      { name: "Microsoft Hazel Desktop", lang: "en-GB", default: false, localService: true, voiceURI: "x" },
    ]);
    const voice = findSystemVoice("uk");
    expect(voice?.name).toBe("Microsoft Hazel Desktop");
  });

  it("falls back to any English voice", () => {
    installVoices([
      { name: "Microsoft Huihui Desktop", lang: "zh-CN", default: true, localService: true, voiceURI: "z" },
      { name: "Some Other English Voice", lang: "en-AU", default: false, localService: false, voiceURI: "w" },
    ]);
    const voice = findSystemVoice("us");
    expect(voice?.lang).toBe("en-AU");
  });

  it("does not pick a Chinese voice", () => {
    installVoices([
      { name: "Microsoft Huihui Desktop", lang: "zh-CN", default: true, localService: true, voiceURI: "z" },
    ]);
    expect(findSystemVoice("us")).toBeNull();
  });

  it("recognises a voice named in British English", () => {
    installVoices([
      { name: "Google UK English Female", lang: "en-GB", default: false, localService: false, voiceURI: "g" },
    ]);
    expect(findSystemVoice("uk")?.name).toBe("Google UK English Female");
  });
});

describe("the accent type", () => {
  it("only allows the two supported accents", () => {
    const accents: Accent[] = ["us", "uk"];
    expect(accents).toHaveLength(2);
  });
});
