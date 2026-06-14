/**
 * Shared test helper: build a {@link QuantifierLookup} from the curated
 * {@link SEED_QUANTIFIERS} list (the same word-forms production seeds into the
 * DB). Synthetic ids are assigned by index. Canonical names + aliases map to
 * the entry; `value` passes through verbatim; `maxTokens` is the widest key in
 * tokens — so the parser fixtures recognise the same word-form quantifiers
 * ("ein", "zwei", "ein halber", …) that used to live in hardcoded code lists.
 */
import type { QuantifierLookup, QuantifierLookupEntry } from "@/lib/recipe-import";
import { SEED_QUANTIFIERS } from "@/db/seed-data/quantifiers";

export function testQuantifierLookup(): QuantifierLookup {
  const byNameOrAlias = new Map<string, QuantifierLookupEntry>();
  const byId = new Map<number, QuantifierLookupEntry>();
  SEED_QUANTIFIERS.forEach((q, i) => {
    const entry: QuantifierLookupEntry = { id: i + 1, name: q.name, value: q.value ?? null };
    byNameOrAlias.set(q.name.toLowerCase(), entry);
    byId.set(entry.id, entry);
    for (const alias of q.aliases) {
      const key = alias.toLowerCase();
      if (!byNameOrAlias.has(key)) byNameOrAlias.set(key, entry);
    }
  });
  let maxTokens = 1;
  for (const k of byNameOrAlias.keys()) {
    maxTokens = Math.max(maxTokens, k.trim().split(/\s+/).length);
  }
  return { byNameOrAlias, byId, maxTokens };
}
