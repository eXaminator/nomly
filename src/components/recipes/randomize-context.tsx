"use client";

import * as React from "react";

/** Number of recipes shown when randomization is active. */
export const RANDOM_SAMPLE_SIZE = 3;

type RandomizeContextValue = {
  /** Whether the list is currently reduced to a random selection. */
  active: boolean;
  /** Bumped on every roll so the grid resamples even when already active. */
  nonce: number;
  /** How many recipes match the current filters — drives the disabled state. */
  available: number;
  /** Activate randomization, or reshuffle when already active. */
  roll: () => void;
  /** Return to the full filtered list. */
  reset: () => void;
  /** The grid reports how many recipes match the current filters. */
  setAvailable: (count: number) => void;
};

const RandomizeContext = React.createContext<RandomizeContextValue | null>(null);

/**
 * Shares the ephemeral "show a few random recipes" state between the filter bar
 * control and whichever list consumes it. Lives only in React state — it never
 * touches the URL, so a reload or shared link returns to the full list.
 *
 * `resetKey` is a serialisation of the active filters: when it changes the
 * randomization clears, so changing any filter returns to the full list.
 * Randomization is a momentary "show me a few" action, not a sticky filter.
 */
export function RandomizeProvider({
  resetKey,
  children,
}: {
  resetKey?: string;
  children: React.ReactNode;
}) {
  const [active, setActive] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);
  const [available, setAvailable] = React.useState(0);

  // Exit randomization whenever the filters change — adjust state during render
  // (React's "reset on prop change" pattern) rather than in an effect, so the
  // full list shows in the same commit the new filter does, with no extra pass.
  const [prevResetKey, setPrevResetKey] = React.useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setActive(false);
  }

  const roll = React.useCallback(() => {
    setActive(true);
    setNonce((n) => n + 1);
  }, []);
  const reset = React.useCallback(() => setActive(false), []);

  const value = React.useMemo(
    () => ({ active, nonce, available, roll, reset, setAvailable }),
    [active, nonce, available, roll, reset],
  );

  return (
    <RandomizeContext.Provider value={value}>
      {children}
    </RandomizeContext.Provider>
  );
}

export function useRandomize(): RandomizeContextValue {
  const ctx = React.useContext(RandomizeContext);
  if (!ctx) {
    throw new Error("useRandomize must be used within a RandomizeProvider");
  }
  return ctx;
}

/**
 * Pick `n` distinct items at random, returned in their original list order so
 * the active sort is preserved. Picks random indices via a partial Fisher–Yates
 * shuffle, then re-sorts the chosen indices ascending before mapping back.
 */
export function sampleRecipes<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  const indices = Array.from({ length: list.length }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (indices.length - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => list[i]);
}

/**
 * List-side counterpart to {@link RandomizeButton}: reports how many recipes
 * are available (so the button can disable on an empty list) and returns either
 * the full list (inactive) or a stable random sample of {@link RANDOM_SAMPLE_SIZE}
 * (active, re-sampled on each roll). The shared hook keeps every list — the main
 * grid, the planner panel, the add-meal modal — sampling identically.
 */
export function useRandomSample<T>(recipes: T[]): {
  active: boolean;
  recipes: T[];
  total: number;
} {
  const { active, nonce, setAvailable } = useRandomize();

  React.useEffect(() => {
    setAvailable(recipes.length);
  }, [recipes.length, setAvailable]);

  const sampled = React.useMemo(
    () => (active ? sampleRecipes(recipes, RANDOM_SAMPLE_SIZE) : recipes),
    // Re-sample on each roll (`nonce`) and whenever the source list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, nonce, recipes],
  );

  return { active, recipes: sampled, total: recipes.length };
}
