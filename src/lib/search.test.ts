import { describe, expect, it } from "vitest";
import { escapeLikeWildcards } from "./search.js";

describe("escapeLikeWildcards", () => {
  it("escapes percent and underscore", () => {
    expect(escapeLikeWildcards("100%")).toBe("100\\%");
    expect(escapeLikeWildcards("corn_starch")).toBe("corn\\_starch");
  });

  it("escapes a literal backslash", () => {
    expect(escapeLikeWildcards("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary text, apostrophes and quotes untouched", () => {
    expect(escapeLikeWildcards("Hershey's cocoa")).toBe("Hershey's cocoa");
    expect(escapeLikeWildcards('12" pizza')).toBe('12" pizza');
  });
});
