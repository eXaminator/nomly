import { describe, expect, it } from "vitest";
import {
  findIngredientCandidates,
  MIN_AUTO_MATCH_SCORE,
  tokenizeCandidate,
  tokensToNotes,
  uncoveredTokens,
  type IngredientCatalog,
} from "@/lib/recipe-import/matching";

/**
 * Tiny static catalog used across the matching tests so each case stays
 * independent of the seeded DB. Mirrors the shape `buildIngredientCatalog`
 * returns in production (canonical entries first, alias entries next).
 */
function catalog(): IngredientCatalog {
  return [
    { ingredientId: 1, canonicalName: "Paprika", aliasName: "Paprika", tokens: ["paprika"] },
    {
      ingredientId: 2,
      canonicalName: "Paprikapulver",
      aliasName: "Paprikapulver",
      tokens: ["paprikapulver"],
    },
    {
      ingredientId: 2,
      canonicalName: "Paprikapulver",
      aliasName: "Paprikapulver rosenscharf",
      tokens: ["paprikapulver", "rosenscharf"],
    },
    { ingredientId: 3, canonicalName: "Tomate", aliasName: "Tomate", tokens: ["tomate"] },
    {
      ingredientId: 3,
      canonicalName: "Tomate",
      aliasName: "Tomaten",
      tokens: ["tomaten"],
    },
    {
      ingredientId: 4,
      canonicalName: "Cherry-Tomate",
      aliasName: "Cherry-Tomate",
      tokens: ["cherry", "tomate"],
    },
    {
      ingredientId: 5,
      canonicalName: "Vollkornbrot",
      aliasName: "Vollkornbrot",
      tokens: ["vollkornbrot"],
    },
    { ingredientId: 6, canonicalName: "Brot", aliasName: "Brot", tokens: ["brot"] },
    { ingredientId: 7, canonicalName: "Ei", aliasName: "Ei", tokens: ["ei"] },
    { ingredientId: 8, canonicalName: "Reis", aliasName: "Reis", tokens: ["reis"] },
  ];
}

describe("findIngredientCandidates", () => {
  it("returns the longest matching alias as the top result", () => {
    const { matches } = findIngredientCandidates(
      "Paprikapulver rosenscharfes",
      catalog(),
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].canonicalName).toBe("Paprikapulver");
    expect(matches[0].aliasName).toBe("Paprikapulver rosenscharf");
  });

  it("treats commas as whitespace so the longest alias still wins", () => {
    // Same line with a comma — the user's original failure case.
    const { matches } = findIngredientCandidates(
      "Paprikapulver, rosenscharfes",
      catalog(),
    );
    expect(matches[0].aliasName).toBe("Paprikapulver rosenscharf");
  });

  it("surfaces matches for distinct ingredients via different alias lengths", () => {
    // Two ingredients hit the candidate: Paprikapulver (long alias wins for
    // that ingredient) and Paprika (different ingredient, shorter prefix
    // match). Both should appear in the result.
    const { matches } = findIngredientCandidates(
      "Paprikapulver rosenscharfes",
      catalog(),
    );
    const canonicalNames = matches.map((m) => m.canonicalName);
    expect(canonicalNames).toContain("Paprikapulver");
    expect(canonicalNames).toContain("Paprika");
  });

  it("doesn't false-match short aliases inside mid-token substrings", () => {
    // "Ei" should NOT match inside "Reis" (no token boundary). "Reis"
    // itself is the right hit.
    const { matches } = findIngredientCandidates("Reis", catalog());
    expect(matches.map((m) => m.canonicalName)).toEqual(["Reis"]);
  });

  it("matches a German compound noun by its rear suffix", () => {
    // "Brot" should suffix-match the token "Vollkornbrot".
    const { matches } = findIngredientCandidates("Vollkornbrot", catalog());
    const names = matches.map((m) => m.canonicalName);
    // The exact-match canonical wins, but the rear-suffix hit is also surfaced.
    expect(names[0]).toBe("Vollkornbrot");
    expect(names).toContain("Brot");
  });

  it("matches multi-token aliases out of order with a score penalty", () => {
    const { matches } = findIngredientCandidates(
      "rosenscharfes Paprikapulver",
      catalog(),
    );
    const top = matches[0];
    expect(top.aliasName).toBe("Paprikapulver rosenscharf");
    expect(top.inOrder).toBe(false);
    // Still wins overall, but the in-order win for the same candidate would
    // score higher (i.e. score is below the in-order-equivalent baseline).
    const inOrderScore =
      findIngredientCandidates(
        "Paprikapulver rosenscharfes",
        catalog(),
      ).matches.find((m) => m.aliasName === "Paprikapulver rosenscharf")!.score;
    expect(top.score).toBeLessThan(inOrderScore);
  });

  it("dedupes matches by ingredient id (best alias wins)", () => {
    // Two entries for ingredient 2 (canonical "Paprikapulver" and alias
    // "Paprikapulver rosenscharf"). The result should hold ONE entry for
    // ingredient 2, picking the longer-aliased one.
    const { matches } = findIngredientCandidates(
      "Paprikapulver rosenscharf",
      catalog(),
    );
    const id2Hits = matches.filter((m) => m.ingredientId === 2);
    expect(id2Hits).toHaveLength(1);
    expect(id2Hits[0].aliasName).toBe("Paprikapulver rosenscharf");
  });

  it("caps results at the supplied limit", () => {
    const { matches } = findIngredientCandidates(
      "Paprikapulver rosenscharfes",
      catalog(),
      { limit: 1 },
    );
    expect(matches).toHaveLength(1);
  });

  it("returns no matches for an unrelated word", () => {
    const { matches } = findIngredientCandidates("Quinoa", catalog());
    expect(matches).toEqual([]);
  });
});

describe("uncoveredTokens + tokensToNotes", () => {
  it("returns the source tokens the match didn't cover", () => {
    const { matches, candidate } = findIngredientCandidates(
      "Paprika edelsüß",
      catalog(),
    );
    const top = matches.find((m) => m.canonicalName === "Paprika");
    expect(top).toBeDefined();
    const leftover = uncoveredTokens(candidate, top!);
    expect(tokensToNotes(leftover)).toBe("edelsüß");
  });
});

describe("MIN_AUTO_MATCH_SCORE gate", () => {
  it("rejects a 1-token prefix-only match (Paprika in Paprikapulver)", () => {
    // Catalog with ONLY the short alias "Paprika"; candidate has the
    // longer compound noun. The matcher does produce a hit (prefix-only,
    // anchored, in-order) but its score must stay below the auto-match
    // threshold so the importer doesn't collapse it into Paprika.
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Paprika", aliasName: "Paprika", tokens: ["paprika"] },
    ];
    const { matches } = findIngredientCandidates(
      "Paprikapulver Rosenscharf",
      cat,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe("Paprika");
    expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE);
  });

  it("rejects a not-anchored 1-token exact match (Tomate inside Cherry-Tomate)", () => {
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tomate", aliasName: "Tomate", tokens: ["tomate"] },
    ];
    const { matches } = findIngredientCandidates("Cherry-Tomate", cat);
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe("Tomate");
    expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE);
  });

  it("accepts an anchored 1-token exact match", () => {
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Paprika", aliasName: "Paprika", tokens: ["paprika"] },
    ];
    const { matches } = findIngredientCandidates("Paprika", cat);
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("accepts a multi-token alias match even with one prefix sub-match", () => {
    const cat: IngredientCatalog = [
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver rosenscharf",
        tokens: ["paprikapulver", "rosenscharf"],
      },
    ];
    const { matches } = findIngredientCandidates(
      "Paprikapulver, rosenscharfes",
      cat,
    );
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });
});

describe("bidirectional matching + length-aware bonus", () => {
  it("auto-matches a close inflection (catalog singular, candidate plural)", () => {
    const cat: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Paprikaschote",
        aliasName: "Paprikaschote",
        tokens: ["paprikaschote"],
      },
    ];
    const { matches } = findIngredientCandidates("Paprikaschoten", cat);
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe("Paprikaschote");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("auto-matches a close inflection in the OTHER direction (catalog plural, candidate singular)", () => {
    // Without bidirectional matching this used to return zero matches —
    // the catalog token was longer than the candidate token, so neither
    // `wt.startsWith(et)` nor `wt.endsWith(et)` fired.
    const cat: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Paprikaschoten",
        aliasName: "Paprikaschoten",
        tokens: ["paprikaschoten"],
      },
    ];
    const { matches } = findIngredientCandidates("Paprikaschote", cat);
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe("Paprikaschoten");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("does NOT auto-match a short-word inflection (Ei / Eis)", () => {
    // Ratio is 0.67 *and* min length is 2, so even with bidirectional
    // matching the score should stay below the gate.
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Ei", aliasName: "Ei", tokens: ["ei"] },
    ];
    const { matches } = findIngredientCandidates("Eis", cat);
    // No prefix match at all here (et "ei" vs wt "eis"): "eis".startsWith("ei")
    // → yes → prefix match. So we do get a hit, but it must stay below the
    // threshold.
    if (matches.length > 0) {
      expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE);
    }
  });

  it("does NOT auto-match a short-word inflection at the min-length floor (Tee / Tees)", () => {
    // Ratio is 0.75 but min length is 3 — the length floor kicks in and
    // keeps this below the auto-match gate.
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tee", aliasName: "Tee", tokens: ["tee"] },
    ];
    const { matches } = findIngredientCandidates("Tees", cat);
    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE);
  });

  it("surfaces (but does not auto-pick) reverse-direction fragments", () => {
    // Catalog "Paprikapulver", candidate "Paprika" — the candidate is now a
    // strict prefix of the catalog token, so bidirectional makes the match
    // visible. Ratio is 0.54, so it stays below the gate.
    const cat: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver",
        tokens: ["paprikapulver"],
      },
    ];
    const { matches } = findIngredientCandidates("Paprika", cat);
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe("Paprikapulver");
    expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE);
  });
});

describe("dual tokenisation — dashes between letters", () => {
  it("auto-matches 'Paprika-Pulver' to a 1-token 'Paprikapulver' catalog over 'Paprika'", () => {
    // Both Paprika and Paprikapulver are in the catalog. With only the
    // dash-as-separator tokenisation, "Paprika-Pulver" would split into
    // ["paprika", "pulver"] and Paprika would win on a 1-token exact hit
    // (score 135) while Paprikapulver could only manage prefix/suffix
    // (115 max). The joined variant ["paprikapulver"] gives Paprikapulver
    // an exact 135 too — alias-length tie-break then picks Paprikapulver.
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Paprika", aliasName: "Paprika", tokens: ["paprika"] },
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver",
        tokens: ["paprikapulver"],
      },
    ];
    const { matches } = findIngredientCandidates("Paprika-Pulver", cat);
    expect(matches[0].canonicalName).toBe("Paprikapulver");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("does not regress when no dashes are in the input", () => {
    // Joined variant is identical to primary, so only one matcher pass
    // happens. Pure regression check.
    const cat: IngredientCatalog = [
      {
        ingredientId: 2,
        canonicalName: "Paprikapulver",
        aliasName: "Paprikapulver",
        tokens: ["paprikapulver"],
      },
    ];
    const { matches } = findIngredientCandidates("Paprikapulver", cat);
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe("Paprikapulver");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("still matches a 2-token catalog entry against space-separated candidate (Cherry Tomate → Cherry-Tomate)", () => {
    // Catalog stores Cherry-Tomate as a 2-token entry (that's how
    // buildIngredientCatalog tokenises dash-using names). A candidate with
    // a space instead of a dash should still align fully via the primary
    // variant, even though the joined variant exists.
    const cat: IngredientCatalog = [
      {
        ingredientId: 4,
        canonicalName: "Cherry-Tomate",
        aliasName: "Cherry-Tomate",
        tokens: ["cherry", "tomate"],
      },
    ];
    const { matches } = findIngredientCandidates("Cherry Tomate", cat);
    expect(matches[0].canonicalName).toBe("Cherry-Tomate");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("still matches a 2-token catalog entry against the dash-form candidate", () => {
    const cat: IngredientCatalog = [
      {
        ingredientId: 4,
        canonicalName: "Cherry-Tomate",
        aliasName: "Cherry-Tomate",
        tokens: ["cherry", "tomate"],
      },
    ];
    const { matches } = findIngredientCandidates("Cherry-Tomate", cat);
    expect(matches[0].canonicalName).toBe("Cherry-Tomate");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("does not collapse Cherry-Tomate into a bare Tomate catalog entry", () => {
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tomate", aliasName: "Tomate", tokens: ["tomate"] },
    ];
    const { matches } = findIngredientCandidates("Cherry-Tomate", cat);
    expect(matches).toHaveLength(1);
    expect(matches[0].canonicalName).toBe("Tomate");
    expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE);
  });
});

describe("tokenizeCandidate", () => {
  it("treats commas/dashes as whitespace", () => {
    const tokens = tokenizeCandidate("Paprikapulver, rosenscharf");
    expect(tokens.map((t) => t.normalized)).toEqual([
      "paprikapulver",
      "rosenscharf",
    ]);
  });
});
