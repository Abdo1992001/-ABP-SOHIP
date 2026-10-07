import { describe, expect, it } from "vitest";
import { matchName, normalizeName, soleExactMatch } from "./name-match.ts";

/**
 * The client names below are the ones the real quotation PDFs print. What
 * matters here is not how many it matches, but that it never quietly picks
 * the wrong customer: a quotation attached to the wrong account is not an
 * error anyone downstream would catch.
 */

const accounts = [
  { id: "a", name: "Concord for Engineering & Contracting" },
  { id: "b", name: "Hassan Allam Construction" },
  { id: "c", name: "Rowad Modern Engineering" },
  { id: "d", name: "Orascom Construction" },
];
const nameOf = (item: { name: string }) => item.name;

describe("normalising a name", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normalizeName("Concord  for Engineering & Contracting")).toBe(
      normalizeName("concord for engineering and contracting"),
    );
  });

  it("handles an Arabic name without mangling it", () => {
    expect(normalizeName("شركة النصر للمقاولات")).toBe("شركة النصر للمقاولات");
  });
});

describe("matching a name read off a document", () => {
  it("finds the customer the document names", () => {
    const found = matchName(
      "Concord for Engineering & Contracting",
      accounts,
      nameOf,
    );
    expect(found[0]?.item.id).toBe("a");
    expect(found[0]?.exact).toBe(true);
  });

  it("still finds it when the document writes the name differently", () => {
    const found = matchName("CONCORD  Engineering", accounts, nameOf);
    expect(found[0]?.item.id).toBe("a");
    expect(found[0]?.exact).toBe(false);
  });

  it("offers nothing rather than a near-miss", () => {
    // "Construction" alone is a word half the list shares, and matching on it
    // would put three customers forward as though one of them were right.
    expect(matchName("Construction", accounts, nameOf)).toEqual([]);
  });

  it("offers nothing for a client the system does not hold", () => {
    expect(matchName("Mark Safi", accounts, nameOf)).toEqual([]);
  });

  it("offers nothing for a document that named no client", () => {
    expect(matchName("", accounts, nameOf)).toEqual([]);
  });

  it("does not match on the words every contractor shares", () => {
    const found = matchName(
      "Contracting Engineering Company",
      accounts,
      nameOf,
    );
    expect(found).toEqual([]);
  });
});

describe("what may be chosen without asking", () => {
  it("preselects one exact match", () => {
    const found = matchName("Hassan Allam Construction", accounts, nameOf);
    expect(soleExactMatch(found)?.id).toBe("b");
  });

  it("does not preselect a close guess", () => {
    const found = matchName("Rowad Engineering", accounts, nameOf);
    expect(found.length).toBeGreaterThan(0);
    expect(soleExactMatch(found)).toBeNull();
  });

  it("does not preselect when two customers carry the same name", () => {
    const twins = [
      { id: "x", name: "Rowad Modern Engineering" },
      { id: "y", name: "Rowad  Modern  Engineering" },
    ];
    const found = matchName("Rowad Modern Engineering", twins, nameOf);
    expect(found).toHaveLength(2);
    expect(soleExactMatch(found)).toBeNull();
  });
});
