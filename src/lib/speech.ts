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
 * The browser's own speech synthesis is the last resort, because the
 * WebView does not always provide an English voice.
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

  const wanted = accent === "uk" ? /en[-_]gb|english.*(united kingdom|uk)|hazel/i : /en[-_]us|english.*united states|zira/i;
  const anyEnglish = /en[-_]/i;

  const exact = voices.find((voice) => wanted.test(voice.name) || wanted.test(voice.lang));
  if (exact) return { name: exact.name, lang: exact.lang };

  const fallback = voices.find((voice) => anyEnglish.test(voice.lang) || /english/i.test(voice.name));
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
    player.onended = () => resolve();
    player.onerror = () => reject(new Error("cannot play the recording"));
    void player.play().catch(reject);
  });
}

/** Stop whatever is currently playing. */
export function stopSpeaking(): void {
  if (player) {
    player.pause();
    player.src = "";
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
export type PronounceOutcome = "recording" | "browser" | "failed";

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

  try {
    const result = await pronounce(text, accent);
    if (result.kind === "cached") {
      await playRecording(result.data, rate);
      return "recording";
    }
  } catch {
    // Fall through to the browser voice.
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
