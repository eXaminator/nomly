# AST parser — changed test expectations

Every row is a line→output expectation that changed because the AST parser's
output is **strictly more faithful to the input** than the old output. Review
each to confirm the new value is what we want.

| Test file | Test title | Input | Old expected | New expected | Why more faithful |
|-----------|-----------|-------|--------------|--------------|-------------------|
| recipe-import-matching | keeps a non-fraction slash in the notes on the matched path | `200g (14 tbsp / 1¾ sticks) unsalted butter, clarified` | notes contain `14 tbsp / 1 ¾ sticks` | notes contain `14 tbsp / 1¾ sticks` | Source has `1¾` (no space); the old token-rejoin invented a space. New = verbatim. |
| recipe-import-matching | '2 shallots (chopped (⅔ cup))' keeps source order in the notes | `2 shallots (chopped (⅔ cup))` | `chopped, ⅔ cup` | `chopped (⅔ cup)` | Only root-level parens unwrap (your rule); the nested `(⅔ cup)` stays verbatim, matching the input. |
| recipe-import-matching | size, paren amount, then comma-tail prep — all comma-separated, in order (new ingredient) | `1/2 pound (225g) large shrimp, peeled and deveined` | `225 g, large, peeled and deveined` | `225g, large, peeled and deveined` | Source `(225g)` has no space; old output inserted one. New = verbatim. |
