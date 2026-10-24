/**
 * How well a word is remembered, for the interface.
 *
 * The retrievability number FSRS exposes measures the decay since the last
 * review, so it reads 100% at the exact moment a word is being practised and
 * carries no information there. What a learner actually wants to know is
 * whether a word is fragile, and how long it will be held for.
 */

import type { FsrsCard } from "./types";

/** The label and tone shown next to a word during practice. */
export interface MemoryStanding {
  /** A short human label such as `新词` or `稳固`. */
  label: string;
  /** How many days the word is currently held for, rounded. */
  intervalDays: number;
  /** A rough quality used to pick a colour. */
  tone: "new" | "fragile" | "settling" | "solid";
  /** How many times the word has been reviewed. */
  reviews: number;
  /** How many times it has been forgotten. */
  lapses: number;
}

/**
 * Describe where a word stands, from its FSRS state.
 *
 * The bands come from stability (the interval the scheduler will give it),
 * because that is the number the schedule actually acts on:
 *
 *   * under a day — still learning, likely to come back today;
 *   * under a week — known but fragile;
 *   * under a month — settling;
 *   * beyond that — solid, and unlikely to be seen again for a while.
 */
export function memoryStanding(card: FsrsCard | null, reviews = 0, lapses = 0): MemoryStanding {
  if (!card) {
    return { label: "新词", intervalDays: 0, tone: "new", reviews: 0, lapses: 0 };
  }

  const intervalDays = Math.max(1, Math.round(card.stability));

  if (intervalDays < 2) {
    return { label: "刚记住", intervalDays, tone: "fragile", reviews, lapses };
  }
  if (intervalDays < 7) {
    return { label: "记忆尚浅", intervalDays, tone: "fragile", reviews, lapses };
  }
  if (intervalDays < 30) {
    return { label: "逐渐稳固", intervalDays, tone: "settling", reviews, lapses };
  }
  return { label: "稳固", intervalDays, tone: "solid", reviews, lapses };
}
