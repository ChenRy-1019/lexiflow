"""Generate the typing sounds.

Two short clicks are synthesised rather than downloaded, so the package
carries no third-party audio and the licence stays clean:

* `key.wav`     — a soft mechanical click for typing a letter.
* `success.wav` — a short two-tone chime for a correct answer.

Both are deliberately quiet: they run on every keystroke.

Usage:
    python scripts/make-sounds.py
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "sounds"

SAMPLE_RATE = 44_100


def write_wav(path: Path, samples: list[float]) -> None:
    """Write mono 16-bit samples, clamping to the valid range."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for value in samples:
            clamped = max(-1.0, min(1.0, value))
            frames.extend(struct.pack("<h", int(clamped * 32767)))
        handle.writeframes(bytes(frames))


def envelope(index: int, total: int, attack: float, decay: float) -> float:
    """A fast attack and an exponential decay, so a click has no pop."""
    position = index / total
    if position < attack:
        return position / attack
    return math.exp(-(position - attack) / decay)


def key_click() -> list[float]:
    """A short, dry click: filtered noise plus a low thump."""
    duration = 0.055
    total = int(SAMPLE_RATE * duration)
    samples: list[float] = []

    # A fixed seed keeps the sound identical between builds.
    seed = 12_345
    for index in range(total):
        seed = (1_103_515_245 * seed + 12_345) % 2**31
        noise = (seed / 2**31) * 2 - 1

        time = index / SAMPLE_RATE
        # A 2.2 kHz component gives the "tick", 220 Hz adds body.
        tick = math.sin(2 * math.pi * 2_200 * time) * 0.35
        body = math.sin(2 * math.pi * 220 * time) * 0.25

        shape = envelope(index, total, attack=0.02, decay=0.18)
        samples.append((noise * 0.28 + tick + body) * shape * 0.42)

    return samples


def success_chime() -> list[float]:
    """Two rising notes, short and soft."""
    duration = 0.3
    total = int(SAMPLE_RATE * duration)
    samples: list[float] = []

    for index in range(total):
        time = index / SAMPLE_RATE
        # The second note starts halfway through.
        first = math.sin(2 * math.pi * 660 * time) * max(0.0, 1 - time / 0.18)
        second_time = max(0.0, time - 0.12)
        second = math.sin(2 * math.pi * 880 * second_time) * max(0.0, 1 - second_time / 0.18)

        shape = envelope(index, total, attack=0.05, decay=0.35)
        samples.append((first * 0.5 + second * 0.5) * shape * 0.3)

    return samples


def main() -> None:
    write_wav(OUT / "key.wav", key_click())
    print(f"wrote {OUT / 'key.wav'}")

    write_wav(OUT / "success.wav", success_chime())
    print(f"wrote {OUT / 'success.wav'}")


if __name__ == "__main__":
    main()
