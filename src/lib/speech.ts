/**
 * Speaking a word.
 *
 * Two sources are tried in turn:
 *
 * 1. A downloaded recording, cached on disk by the backend. These are real
 *    human recordings and sound natural.
 * 2. The speech synthesiser installed on the machine. This always works but
 *    sounds flatter.
 *
 * Only one of them may be audible at a time. Two failure modes made that
 * untrue in practice, and both are handled here:
 *
 * - A slow request for an earlier word resolving after the learner had
 *   already moved on. Its fallback voice would start speaking over the new
 *   word. Every request carries a generation token and a superseded request
 *   stops before it makes a sound.
 * - Prefetching a word used to play it. Fetching and playing are now
 *   separate operations, so warming the cache is silent.
 */

import { pronounce } from "./api";

/** The accent a word is pronounced in. */
export type Accent = "us" | "uk";

/** The voice used when the system synthesiser takes over. */
export interface SystemVoice {
  /** The name of the voice in the browser's voice list. */
  name: string;
  /** The BCP-47 language tag. */
  lang: string;
}

/**
 * Find an English voice for the browser's speech synthesis.
 *
 * Windows installs a voice called "Microsoft Zira Desktop" for American
 * English and "Microsoft Hazel Desktop" for British English. The web view
 * exposes them with slightly different names, so the search is fuzzy.
 */
export function findSystemVoice(accent: Accent): SystemVoice | null {
  if (typeof speechSynthesis === "undefined") return null;

  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const wanted =
    accent === "uk"
      ? /en[-_]gb|english.*(united kingdom|uk)|hazel/i
      : /en[-_]us|english.*united states|zira/i;
  const anyEnglish = /en[-_]/i;

  const exact = voices.find((voice) => wanted.test(voice.name) || wanted.test(voice.lang));
  if (exact) return { name: exact.name, lang: exact.lang };

  const fallback = voices.find(
    (voice) => anyEnglish.test(voice.lang) || /english/i.test(voice.name),
  );
  if (fallback) return { name: fallback.name, lang: fallback.lang };

  return null;
}

/** Speak a word with the browser's speech synthesis. */
export function speakWithBrowser(text: string, accent: Accent): boolean {
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
    return false;
  }

  const voice = findSystemVoice(accent);
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.voice = speechSynthesis.getVoices().find((item) => item.name === voice.name) ?? null;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = accent === "uk" ? "en-GB" : "en-US";
  }
  utterance.rate = 0.9;
  utterance.pitch = 1;

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  return true;
}

/** An audio element used to play the cached recordings. */
let player: HTMLAudioElement | null = null;

/**
 * The blob URL of the recording that is currently loaded.
 *
 * The object URL has to be revoked, otherwise the audio data stays in memory
 * for the lifetime of the window.
 */
let currentUrl: string | null = null;

/** Settles the promise of a playback that was interrupted. */
let pendingResolve: (() => void) | null = null;

/**
 * The current request number.
 *
 * Every play request takes a number; a request whose number is no longer the
 * current one has been superseded by a newer word and must stay silent.
 */
let generation = 0;

/** Play a recording that the backend sent as base64. */
export function playRecording(base64: string, rate = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!player) {
      player = new Audio();
    }
    player.pause();

    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }

    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      currentUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("cannot decode the recording"));
      return;
    }

    player.src = currentUrl;
    player.playbackRate = rate;
    pendingResolve = resolve;
    player.onended = () => {
      pendingResolve = null;
      resolve();
    };
    player.onerror = () => {
      pendingResolve = null;
      reject(new Error("cannot play the recording"));
    };
    void player.play().catch((error) => {
      pendingResolve = null;
      reject(error);
    });
  });
}

/** Stop whatever is currently playing, and cancel anything still in flight. */
export function stopSpeaking(): void {
  // Invalidate every request that has not reached the speaker yet.
  generation += 1;

  if (pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve();
  }

  if (player) {
    player.pause();
    player.removeAttribute("src");
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.cancel();
  }
}

/** How a word was pronounced, for the interface to report. */
export type PronounceOutcome = "recording" | "browser" | "superseded" | "failed";

/**
 * Download a word's recording without playing it.
 *
 * Used to warm the cache when a new word appears, so the audible request that
 * follows a moment later is served from memory. It deliberately makes no
 * sound: playing here used to overlap with the real request and produced two
 * voices at once.
 */
export async function prefetch(word: string, accent: Accent): Promise<void> {
  const text = word.trim();
  if (!text) return;
  try {
    await pronounce(text, accent);
  } catch {
    // A failed prefetch is not worth reporting; the audible request retries.
  }
}

/**
 * Pronounce a word.
 *
 * The recording is fetched through the backend, which caches it, so the
 * second time a word is played it is served from disk.
 */
export async function speak(
  word: string,
  accent: Accent,
  rate = 1,
): Promise<PronounceOutcome> {
  const text = word.trim();
  if (!text) return "failed";

  generation += 1;
  const token = generation;

  let result: Awaited<ReturnType<typeof pronounce>> | null = null;
  try {
    result = await pronounce(text, accent);
  } catch {
    result = null;
  }

  // A newer word took over while this one was downloading.
  if (token !== generation) return "superseded";

  if (result?.kind === "cached") {
    try {
      // The synthesiser and the recording must never overlap.
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      await playRecording(result.data, rate);
      return "recording";
    } catch {
      // Fall through to the system voice.
    }
    if (token !== generation) return "superseded";
  }

  if (player) {
    player.pause();
  }
  if (speakWithBrowser(text, accent)) return "browser";
  return "failed";
}

/**
 * Make the browser's voice list available.
 *
 * Some web views populate the list asynchronously, so the caller has to wait
 * for the `voiceschanged` event before asking for the voices.
 */
export function whenVoicesReady(): Promise<void> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve();
  if (speechSynthesis.getVoices().length > 0) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 1500);
    speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
