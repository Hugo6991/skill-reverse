// @ts-expect-error The CSS token checker is a Node ESM script tested through its public export.
import { findUndefinedCustomProperties } from "../scripts/check-ui-tokens.mjs";
import { describe, expect, it } from "vitest";

describe("CSS token QA", () => {
  it("accepts declared custom properties and explicit fallbacks", () => {
    expect(
      findUndefinedCustomProperties(`
        :root { --space-4: 16px; }
        .card {
          gap: var(--space-4);
          color: var(--runtime-accent, rebeccapurple);
        }
      `)
    ).toEqual([]);
  });

  it("reports undefined custom properties without fallbacks", () => {
    expect(
      findUndefinedCustomProperties(`
        .card {
          margin: var(--space-5);
          padding: var(--space-5);
          color: var(--runtime-accent, rebeccapurple);
        }
      `)
    ).toEqual(["space-5"]);
  });
});
