/**
 * Word-level diff between the current and proposed NOTES of one ingredient
 * row, for the bulk-reparse dialog. Whole-string highlighting hides what
 * actually changed when notes are long; this marks only the words that
 * differ (classic LCS), so a casing fix or one inserted word reads at a
 * glance. Tokens compare EXACTLY (including case and punctuation) — the
 * line-level "notes changed" flag uses the same strictness, so anything
 * that flagged the line also shows up here.
 */

export type NotesDiffSegment = { text: string; changed: boolean };

export type NotesDiff = {
  /** Segments of the CURRENT side; `changed` = removed/replaced words. */
  current: NotesDiffSegment[];
  /** Segments of the PROPOSED side; `changed` = added/replaced words. */
  proposed: NotesDiffSegment[];
};

/** Merge a per-token changed/unchanged run into space-joined segments. */
function mergeSegments(
  tokens: { token: string; changed: boolean }[],
): NotesDiffSegment[] {
  const out: NotesDiffSegment[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (last && last.changed === t.changed) {
      last.text += ` ${t.token}`;
    } else {
      out.push({ text: t.token, changed: t.changed });
    }
  }
  return out;
}

export function diffNotes(
  oldText: string | null,
  newText: string | null,
): NotesDiff {
  const a = (oldText ?? "").split(/\s+/).filter((t) => t.length > 0);
  const b = (newText ?? "").split(/\s+/).filter((t) => t.length > 0);
  const m = a.length;
  const n = b.length;
  // LCS length table (suffix form): dp[i][j] = LCS of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aTok: { token: string; changed: boolean }[] = [];
  const bTok: { token: string; changed: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      aTok.push({ token: a[i], changed: false });
      bTok.push({ token: b[j], changed: false });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      aTok.push({ token: a[i], changed: true });
      i += 1;
    } else {
      bTok.push({ token: b[j], changed: true });
      j += 1;
    }
  }
  while (i < m) aTok.push({ token: a[i++], changed: true });
  while (j < n) bTok.push({ token: b[j++], changed: true });
  return { current: mergeSegments(aTok), proposed: mergeSegments(bTok) };
}
