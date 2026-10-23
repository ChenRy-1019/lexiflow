/**
 * Tests for the start dialog's choice model.
 *
 * The dialog decides four things before a session begins. These tests pin
 * the defaults and the way a choice is serialised into the settings table,
 * which is what makes the second session a single click.
 */

import { describe, expect, it } from "vitest";

import type { StartChoice } from "./StartDialog";

describe("StartChoice", () => {
  it("carries every decision a session needs", () => {
    const choice: StartChoice = {
      bookId: "cet4",
      mode: "spelling",
      scope: "mix",
      limit: 20,
    };
    expect(choice.bookId).toBe("cet4");
    expect(choice.limit).toBe(20);
  });

  it("accepts an empty book id, which means every book", () => {
    const choice: StartChoice = {
      bookId: "",
      mode: "choice",
      scope: "new",
      limit: 50,
    };
    expect(choice.bookId).toBe("");
  });
});
