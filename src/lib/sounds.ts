/**
 * Interface sounds.
 *
 * Short sounds confirm that a keystroke registered and that an answer was
 * right. They are synthesised (see `scripts/make-sounds.py`), so the build
 * ships no third-party audio.
 *
 * A keystroke sound fires on every character, so the element is created once
 * and rewound rather than rebuilt: creating a player per keystroke dropped
 * sounds while a fast typist was ahead of it.
 */

/** Which sounds the interface can play. */
export type SoundName = "key" | "success";

/** Clip paths, resolved against the frontend root. */
const SOURCES: Record<SoundName, string> = {
  key: "/sounds/key.wav",
  success: "/sounds/success.wav",
};

/** One player per sound, reused across plays. */
const players = new Map<SoundName, HTMLAudioElement>();

/** Whether sound is enabled, kept in step with the settings. */
let enabled = true;

/** Silence the interface sounds. */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

/** Whether sound is currently enabled. */
export function isSoundEnabled(): boolean {
  return enabled;
}

/** Get (and lazily create) the player for a sound. */
function playerFor(name: SoundName): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  const existing = players.get(name);
  if (existing) return existing;

  const audio = new Audio(SOURCES[name]);
  audio.preload = "auto";
  audio.volume = name === "key" ? 0.35 : 0.5;
  players.set(name, audio);
  return audio;
}

/**
 * Play a sound.
 *
 * Rewinding to zero means a held-down key restarts the click instead of
 * queueing silence behind a sound that has already finished.
 */
export function playSound(name: SoundName): void {
  if (!enabled) return;
  const audio = playerFor(name);
  if (!audio) return;

  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // A browser may refuse playback before any user gesture; that is fine,
      // the next keystroke after interaction will succeed.
    });
  } catch {
    // A missing clip should never break typing.
  }
}

/** Warm the players so the first keystroke is not delayed by loading. */
export function preloadSounds(): void {
  for (const name of Object.keys(SOURCES) as SoundName[]) {
    playerFor(name);
  }
}
