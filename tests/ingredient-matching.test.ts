import { describe, expect, it } from "vitest";
import {
  buildCatalogBlockIndex,
  findIngredientCandidates,
  MIN_AUTO_MATCH_SCORE,
  tokenizeCandidate,
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

describe("coveredCandidateTokens span", () => {
  it("reports only the input tokens the match covers", () => {
    const { matches } = findIngredientCandidates("Paprika edelsüß", catalog());
    const top = matches.find((m) => m.canonicalName === "Paprika");
    expect(top).toBeDefined();
    // "Paprika" covers token 0; "edelsüß" (token 1) is left for notes.
    expect(top!.coveredCandidateTokens).toEqual([0]);
    expect(top!.candidate.map((t) => t.raw)).toEqual(["Paprika", "edelsüß"]);
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

  it("matches the bare entry when the catalog lacks the specific product (descriptor → notes)", () => {
    // Structural model: with ONLY a bare "Tomate" entry seeded, "Cherry
    // Tomate" resolves to Tomate and "Cherry" falls outside the matched span
    // (→ notes). Identity lives in the catalog: seed "Cherry Tomate" as its
    // own entry and it wins by token count (see next test).
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tomate", aliasName: "Tomate", tokens: ["tomate"] },
    ];
    const { matches } = findIngredientCandidates("Cherry Tomate", cat);
    expect(matches[0].canonicalName).toBe("Tomate");
    expect(matches[0].coveredCandidateTokens).toEqual([1]); // "Tomate" only
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("prefers the specific multi-token entry when the catalog has it", () => {
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tomate", aliasName: "Tomate", tokens: ["tomate"] },
      {
        ingredientId: 2,
        canonicalName: "Cherry-Tomate",
        aliasName: "Cherry-Tomate",
        tokens: ["cherry", "tomate"],
      },
    ];
    const { matches } = findIngredientCandidates("Cherry Tomate", cat);
    expect(matches[0].canonicalName).toBe("Cherry-Tomate");
    expect(matches[0].coveredCandidateTokens).toEqual([0, 1]);
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

  it("a 2-char stopword does not prefix/suffix-match a long entry token", () => {
    // "to" must NOT suffix-match "risotto" ("risotto".endsWith("to")). Without
    // the 3-char fragment floor, "rice to" fully covers "risotto rice" (220)
    // and beats the exact "rice" (130). The floor keeps "rice" the winner.
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "rice", aliasName: "rice", tokens: ["rice"] },
      {
        ingredientId: 2,
        canonicalName: "risotto rice",
        aliasName: "risotto rice",
        tokens: ["risotto", "rice"],
      },
    ];
    expect(
      findIngredientCandidates("rice to serve", cat).matches[0].ingredientId,
    ).toBe(1);
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

  it("matches the dash-form against a bare Tomate entry (descriptor → notes)", () => {
    // Dash-form mirror of the structural-flip case: only a bare "Tomate"
    // entry seeded, so "Cherry-Tomate" resolves to Tomate with "Cherry"
    // outside the span (→ notes). Seed "Cherry-Tomate" to win by tokens.
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Tomate", aliasName: "Tomate", tokens: ["tomate"] },
    ];
    const { matches } = findIngredientCandidates("Cherry-Tomate", cat);
    expect(matches[0].canonicalName).toBe("Tomate");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
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

describe("tokenizeCandidate postComma", () => {
  it("flags every token after the first comma as postComma", () => {
    const toks = tokenizeCandidate("olive oil, divided");
    expect(toks.map((t) => t.raw)).toEqual(["olive", "oil", "divided"]);
    expect(toks.map((t) => t.postComma)).toEqual([false, false, true]);
  });

  it("treats tokens before any comma as pre-comma", () => {
    const toks = tokenizeCandidate("chick peas in a can");
    expect(toks.every((t) => t.postComma === false)).toBe(true);
  });

  it("still splits on semicolon/slash/dash without flagging postComma", () => {
    const toks = tokenizeCandidate("salz/pfeffer");
    expect(toks.map((t) => t.raw)).toEqual(["salz", "pfeffer"]);
    expect(toks.map((t) => t.postComma)).toEqual([false, false]);
  });

  it("folds '&', 'und' and 'and' onto one normalized token", () => {
    expect(tokenizeCandidate("Salz & Pfeffer").map((t) => t.normalized)).toEqual([
      "salz",
      "und",
      "pfeffer",
    ]);
    expect(tokenizeCandidate("Salz und Pfeffer").map((t) => t.normalized)).toEqual([
      "salz",
      "und",
      "pfeffer",
    ]);
    expect(tokenizeCandidate("Salt and Pepper").map((t) => t.normalized)).toEqual([
      "salt",
      "und",
      "pepper",
    ]);
  });
});

describe("structural matcher scoring", () => {
  function entry(id: number, alias: string, canonical = alias) {
    return {
      ingredientId: id,
      canonicalName: canonical,
      aliasName: alias,
      tokens: alias.toLowerCase().split(/\s+/),
    };
  }

  it("single exact token clears 130 even with extra input tokens", () => {
    const { matches } = findIngredientCandidates("Salt divided", [
      entry(1, "Salt"),
    ]);
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].score).toBe(130); // 100 + 20 + 10 (no canonical score boost)
    expect(matches[0].coveredCandidateTokens).toEqual([0]);
  });

  it("post-comma discount lets pre-comma 2-token beat a comma-spanning 2-token", () => {
    const { matches } = findIngredientCandidates("olive oil, divided", [
      entry(1, "olive oil"),
      entry(2, "oil divided"), // simulates a polluted catalog row
    ]);
    expect(matches[0].ingredientId).toBe(1); // 250 beats 210
    expect(matches[0].score).toBe(250);
    expect(matches.find((m) => m.ingredientId === 2)?.score).toBe(210);
  });

  it("full multi-token contiguous match scores 100/token + bonuses", () => {
    const { matches } = findIngredientCandidates(
      "frozen chick peas in a can",
      [entry(1, "chick peas")],
    );
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].score).toBe(250); // 100 + 100 + 20 + 20 + 10
    expect(matches[0].coveredCandidateTokens).toEqual([1, 2]);
  });

  it("partial lookup coverage is penalised and loses to the shorter full match", () => {
    const cat = [entry(1, "Tomate"), entry(2, "Cherry Tomate")];
    const { matches } = findIngredientCandidates("Tomaten", cat);
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].score).toBe(130);
    // "Cherry Tomate" covers only "Tomate" (1 of 2 tokens); the uncovered
    // "Cherry" costs −120: 100 + 20 + 10 − 120 = 10.
    expect(matches.find((m) => m.ingredientId === 2)?.score).toBe(10);
  });

  it("a fully-covered entry beats a partial one even when the partial matched MORE input tokens", () => {
    // "quick cooking oats": "oat cooking cream" matches two input tokens
    // (cooking + oat~oats) but leaves "cream" uncovered; "oats" matches one
    // and is fully covered. Net coverage must let "oats" win.
    const { matches } = findIngredientCandidates("quick cooking oats", [
      entry(1, "oats"),
      entry(2, "oat cooking cream"),
    ]);
    expect(matches[0].ingredientId).toBe(1);
  });

  it("a compound suffix is a fragment, not a close inflection — exact stem wins", () => {
    // "Kichererbsenmehl" (chickpea flour) is a prefix-match for input
    // "Kichererbsen" at ratio 12/16 = 0.75, but the 4-char compound head
    // "mehl" is no inflection, so it earns no close-inflection bonus and
    // loses to the exact "Kichererbsen".
    const { matches } = findIngredientCandidates("Kichererbsen", [
      entry(2, "Kichererbsenmehl"),
      entry(1, "Kichererbsen"),
    ]);
    expect(matches[0].ingredientId).toBe(1);
  });

  it("full coverage of the longer entry wins when the input supports it", () => {
    const cat = [entry(1, "Tomate"), entry(2, "Cherry Tomate")];
    const { matches } = findIngredientCandidates("Cherry Tomaten", cat);
    expect(matches[0].ingredientId).toBe(2);
    expect(matches[0].score).toBe(250);
  });

  it("prefix fragments stay below the gate", () => {
    const { matches } = findIngredientCandidates("Paprikapulver Rosenscharf", [
      entry(1, "Paprika"),
    ]);
    expect(matches[0]?.score ?? 0).toBeLessThan(130);
  });

  it("matches an alias spelled with 'und' against a line using '&'", () => {
    // The catalog tokenizer folds "&"/"und"/"and" to "und", so the entry's
    // tokens are ["salz", "und", "pfeffer"] regardless of the source spelling.
    const cat = [{ ...entry(1, "Salz und Pfeffer"), tokens: ["salz", "und", "pfeffer"] }];
    const { matches } = findIngredientCandidates("Salz & Pfeffer", cat);
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });
});

describe("a registered alias wins over the canonical it normalizes near", () => {
  // Diacritics are stripped for matching, so "Äpfel" and "Apfel" both tokenize
  // to ["apfel"] and tie on the structural score; the canonical's +1 boost
  // must NOT shadow the verbatim alias. "Zwiebeln" only matches the canonical
  // "Zwiebel" as a close-inflection prefix, so the exact alias must win there.
  const cat: IngredientCatalog = [
    { ingredientId: 1, canonicalName: "Apfel", aliasName: "Apfel", tokens: ["apfel"] },
    { ingredientId: 1, canonicalName: "Apfel", aliasName: "Äpfel", tokens: ["apfel"] },
    { ingredientId: 2, canonicalName: "Zwiebel", aliasName: "Zwiebel", tokens: ["zwiebel"] },
    { ingredientId: 2, canonicalName: "Zwiebel", aliasName: "Zwiebeln", tokens: ["zwiebeln"] },
  ];

  it("keeps the diacritic alias as the display name (Äpfel, not Apfel)", () => {
    const { matches } = findIngredientCandidates("Äpfel", cat);
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].aliasName).toBe("Äpfel");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("keeps the plural alias as the display name (Zwiebeln, not Zwiebel)", () => {
    const { matches } = findIngredientCandidates("Zwiebeln", cat);
    expect(matches[0].ingredientId).toBe(2);
    expect(matches[0].aliasName).toBe("Zwiebeln");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("still leads with the canonical when the input matches it verbatim", () => {
    expect(findIngredientCandidates("Apfel", cat).matches[0].aliasName).toBe("Apfel");
    expect(findIngredientCandidates("Zwiebel", cat).matches[0].aliasName).toBe("Zwiebel");
  });

  it("keeps the plural alias even when the query carries leading qty/unit tokens", () => {
    // The live matcher queries the FULL source line, so the ingredient only
    // covers the last token. The verbatim-alias preference must survive the
    // un-covered qty/unit extras — otherwise the within-ingredient tie falls
    // back to the canonical ("Zwiebel" / "Mandel") and drops the plural.
    expect(
      findIngredientCandidates("2 Esslöffel Zwiebeln", cat).matches[0].aliasName,
    ).toBe("Zwiebeln");
    expect(
      findIngredientCandidates("200 g Äpfel", cat).matches[0].aliasName,
    ).toBe("Äpfel");
  });

  it("a hyphen-only difference is NOT a surface win — the canonical keeps its hyphen", () => {
    // The candidate tokenizer splits "plant-based" into ["plant","based"], so
    // the matched span carries no hyphen. Comparing verbatim would let the
    // de-hyphenated alias "plant based meat" win; folding separators to spaces
    // makes it a tie and the canonical "Plant-based meat" (closer to the input)
    // wins. Works whether or not the input itself has the hyphen.
    const hyphen: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Plant-based meat",
        aliasName: "Plant-based meat",
        tokens: ["plant", "based", "meat"],
      },
      {
        ingredientId: 1,
        canonicalName: "Plant-based meat",
        aliasName: "plant based meat",
        tokens: ["plant", "based", "meat"],
      },
    ];
    expect(
      findIngredientCandidates("plant-based meat", hyphen).matches[0].aliasName,
    ).toBe("Plant-based meat");
    expect(
      findIngredientCandidates("plant based meat", hyphen).matches[0].aliasName,
    ).toBe("Plant-based meat");
  });
});

describe("fuzzy alignment tier (single-typo tolerance)", () => {
  function entry(id: number, alias: string, canonical = alias) {
    return {
      ingredientId: id,
      canonicalName: canonical,
      aliasName: alias,
      tokens: alias.toLowerCase().split(/\s+/),
    };
  }

  it("a fuzzy token COMPLETING a multi-token alias auto-picks it over the bare head noun", () => {
    // "planzliche" (typo, missing f) fuzzy-matches "pflanzliche"; "milch" is
    // exact. The 2-token alias is fully covered and beats lone "Milch".
    const cat: IngredientCatalog = [
      { ingredientId: 1, canonicalName: "Milch", aliasName: "Milch", tokens: ["milch"] },
      {
        ingredientId: 2,
        canonicalName: "Pflanzenmilch",
        aliasName: "pflanzliche Milch",
        tokens: ["pflanzliche", "milch"],
      },
    ];
    const { matches } = findIngredientCandidates("planzliche Milch", cat);
    expect(matches[0].ingredientId).toBe(2);
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
  });

  it("a LONE fuzzy match stays below the auto-pick gate (suggestion only)", () => {
    // "bitter" fuzzy-matches "butter" (1 substitution, len 6) but a single
    // fuzzy token earns no bonus, so it can't clear the threshold.
    const { matches } = findIngredientCandidates("bitter", [entry(1, "butter")]);
    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE);
  });

  it("does NOT fuzzy-match below the length floor (short words stay distinct)", () => {
    // "Salm" vs "Salz" (len 4) is one substitution but too short to fuzzy —
    // short words flip meaning on a single edit.
    expect(findIngredientCandidates("Salm", [entry(1, "Salz")]).matches).toHaveLength(0);
  });

  it("does NOT fuzzy-match at edit distance 2", () => {
    // "bitten" vs "butter": u->i and n->r = two edits.
    expect(findIngredientCandidates("bitten", [entry(1, "butter")]).matches).toHaveLength(0);
  });
});

describe("unit decider", () => {
  const DOSE = 12,
    STUECK = 14,
    G = 1;
  // fresh Tomate (Stück) vs Dosentomate (Dose); both share base + descriptor
  // aliases so the unit, not the name, is what distinguishes them.
  function cat() {
    const e = (id: number, c: string, a: string, unitId: number) => ({
      ingredientId: id,
      canonicalName: c,
      aliasName: a,
      tokens: a.toLowerCase().split(/\s+/),
      unitId,
    });
    return [
      e(123, "Tomate", "Tomate", STUECK),
      e(123, "Tomate", "tomatoes", STUECK),
      e(123, "Tomate", "Tomaten", STUECK),
      e(580, "Dosentomate", "Dosentomate", DOSE),
      e(580, "Dosentomate", "tomatoes", DOSE),
      e(580, "Dosentomate", "Tomaten", DOSE),
      e(580, "Dosentomate", "chopped tomatoes", DOSE),
    ];
  }

  it("unit Dose picks the canned variant when both clear the gate (shared alias)", () => {
    const { matches } = findIngredientCandidates("Tomaten", cat(), {
      lineUnitId: DOSE,
    });
    expect(matches[0].ingredientId).toBe(580);
  });

  it("unit Stück picks fresh for the same shared alias", () => {
    const { matches } = findIngredientCandidates("Tomaten", cat(), {
      lineUnitId: STUECK,
    });
    expect(matches[0].ingredientId).toBe(123);
  });

  it("unit Stück overrides a higher NAME score (fresh beats canned 'chopped tomatoes')", () => {
    // "tomatoes, chopped": canned matches both tokens (~200), fresh only
    // "tomatoes" (~130) — yet Stück must flip it to fresh.
    const { matches } = findIngredientCandidates("tomatoes, chopped", cat(), {
      lineUnitId: STUECK,
    });
    expect(matches[0].ingredientId).toBe(123);
  });

  it("non-matching unit (g) falls back to name score → canned wins on 'chopped tomatoes'", () => {
    const { matches } = findIngredientCandidates("chopped tomatoes", cat(), {
      lineUnitId: G,
    });
    expect(matches[0].ingredientId).toBe(580);
  });

  it("doubling never crosses the gate: a below-gate unit match does not auto-clear", () => {
    // "Dosento" prefix-matches only "Dosentomate" (no bonus) → ~110 < 130.
    const only = [
      {
        ingredientId: 580,
        canonicalName: "Dosentomate",
        aliasName: "Dosentomate",
        tokens: ["dosentomate"],
        unitId: DOSE,
      },
    ];
    const { matches } = findIngredientCandidates("Dosento", only, {
      lineUnitId: DOSE,
    });
    expect(matches[0].score).toBeLessThan(MIN_AUTO_MATCH_SCORE);
  });
});

describe("block index equivalence", () => {
  // A catalog exercising exact, prefix, suffix, inflection and compound cases —
  // the indexed path must return byte-identical top results to the full sweep.
  function bigCatalog(): IngredientCatalog {
    const e = (id: number, alias: string, canonical = alias) => ({
      ingredientId: id,
      canonicalName: canonical,
      aliasName: alias,
      tokens: alias.toLowerCase().split(/\s+/),
    });
    return [
      e(1, "Paprika"),
      e(2, "Paprikapulver"),
      e(2, "Paprikapulver rosenscharf"),
      e(3, "Tomate"),
      e(3, "Tomaten"),
      e(4, "Cherry Tomate"),
      e(5, "Vollkornbrot"),
      e(6, "Brot"),
      e(7, "Spinat"),
      e(7, "Blattspinat"),
      e(8, "Olivenöl extra vergine"),
      e(9, "Kichererbsen"),
      e(10, "Kichererbsenmehl"),
      e(11, "pflanzliche Milch"),
      e(12, "Mandel"),
      e(12, "Mandeln"),
      e(13, "Zwiebel"),
      e(14, "rote Zwiebel"),
    ];
  }

  const inputs = [
    "Paprika",
    "Paprikapulver",
    "Paprikapulver rosenscharfes",
    "rosenscharfes Paprikapulver",
    "Tomaten",
    "Cherry-Tomate",
    "Blattspinat",
    "junger frischer Blattspinat",
    "extra vergine Olivenöl",
    "Kichererbsenmehl",
    "planzliche Milch", // single typo → fuzzy
    "Mandeln",
    "rote Zwiebeln",
    "200 g Mehl, gesiebt",
    "etwas völlig Unbekanntes",
  ];

  it("indexed path returns identical matches to the full sweep", () => {
    const cat = bigCatalog();
    const index = buildCatalogBlockIndex(cat);
    for (const input of inputs) {
      const full = findIngredientCandidates(input, cat);
      const idx = findIngredientCandidates(input, cat, { index });
      expect(idx.matches.map((m) => [m.ingredientId, m.aliasName, m.score])).toEqual(
        full.matches.map((m) => [m.ingredientId, m.aliasName, m.score]),
      );
    }
  });
});

describe("exact alias vs close-compound canonical (Erdnuss regression)", () => {
  // Prod case: "4 EL Erdnuss". "Erdnussöl" aligns as a prefix and the 2-char
  // compound head "-öl" slips through the close-inflection bonus window
  // (Δ2, ratio 7/9 ≥ 0.75), tying the genuine plural "Erdnüsse". The curated
  // alias "Erdnuss" must settle this: a verbatim EXACT match may never lose
  // to a non-exact alignment of another ingredient — neither the canonical
  // score boost nor the name-length tiebreak may override alignment
  // exactness.
  const cat: IngredientCatalog = [
    {
      ingredientId: 404,
      canonicalName: "Erdnussöl",
      aliasName: "Erdnussöl",
      tokens: ["erdnussol"],
    },
    {
      ingredientId: 491,
      canonicalName: "Erdnüsse",
      aliasName: "Erdnüsse",
      tokens: ["erdnusse"],
    },
    {
      ingredientId: 491,
      canonicalName: "Erdnüsse",
      aliasName: "Erdnuss",
      tokens: ["erdnuss"],
    },
  ];

  it("ranks the exact alias above the close-compound canonical and auto-picks it", () => {
    const { matches } = findIngredientCandidates("Erdnuss", cat);
    expect(matches[0].ingredientId).toBe(491);
    expect(matches[0].aliasName).toBe("Erdnuss");
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
    expect(matches[1].ingredientId).toBe(404);
  });

  it("keeps the canonical preferred over an equally-exact alias of another ingredient", () => {
    // Counter-guard: exactness decides only when it differs. Two all-exact
    // hits on different ingredients still prefer the canonical row.
    const tie: IngredientCatalog = [
      {
        ingredientId: 1,
        canonicalName: "Erdnuss",
        aliasName: "Erdnuss",
        tokens: ["erdnuss"],
      },
      {
        ingredientId: 2,
        canonicalName: "Erdnüsse",
        aliasName: "Erdnuss",
        tokens: ["erdnuss"],
      },
    ];
    const { matches } = findIngredientCandidates("Erdnuss", tie);
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].isCanonical).toBe(true);
  });
});

describe("position tiebreak — earlier match wins ties", () => {
  // Trailing content in ingredient lines is overwhelmingly annotation
  // ("z.B. Olivenöl", "for garnish"). With NO vocabulary involved, the
  // structural rule is: at equal score and exactness, the match that starts
  // EARLIER in the line wins. This replaces the old z.B./zum boundary
  // word-lists' ranking role now that the matcher sees the pristine line.
  const cat: IngredientCatalog = [
    { ingredientId: 1, canonicalName: "Öl", aliasName: "Öl", tokens: ["ol"] },
    {
      ingredientId: 2,
      canonicalName: "Olivenöl",
      aliasName: "Olivenöl",
      tokens: ["olivenol"],
    },
  ];

  it("'Öl z.B. Olivenöl' maps to the earlier Öl, not the trailing example", () => {
    const { matches } = findIngredientCandidates("Öl z.B. Olivenöl", cat);
    expect(matches[0].ingredientId).toBe(1);
    expect(matches[0].score).toBeGreaterThanOrEqual(MIN_AUTO_MATCH_SCORE);
    expect(matches[1].ingredientId).toBe(2);
  });

  it("a later match with a HIGHER score still wins — position only breaks ties", () => {
    const withAlias: IngredientCatalog = [
      ...cat,
      {
        ingredientId: 3,
        canonicalName: "Bratöl",
        aliasName: "Öl zum Braten",
        tokens: ["ol", "zum", "braten"],
      },
    ];
    const { matches } = findIngredientCandidates("Öl zum Braten", withAlias);
    expect(matches[0].ingredientId).toBe(3); // 3-token full coverage beats 1-token
  });
});
