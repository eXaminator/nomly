"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Hooks that persist a list view's filter / sort / search state as URL query
// params. Reloads and back-navigation restore exactly what the user had on
// screen. Writes always go through `router.replace` so typing a search doesn't
// pollute the browser history.

type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir } | null;

/** Pure: encode a sort state as a URL value ("name:asc"). Null → null (param
 *  should be dropped from the URL). */
export function encodeSort(sort: SortState): string | null {
  return sort ? `${sort.key}:${sort.dir}` : null;
}

/** Pure: decode the URL value back into a sort state. Tolerates missing /
 *  malformed values by returning null. */
export function decodeSort(raw: string | null | undefined): SortState {
  if (!raw) return null;
  const [key, dir] = raw.split(":");
  if (!key) return null;
  if (dir !== "asc" && dir !== "desc") return null;
  return { key, dir };
}

/** Pure: cycle through the sort states for one column on each click —
 *  inactive → asc → desc → cleared. Matches the existing ListShell behaviour. */
export function cycleSort(prev: SortState, key: string): SortState {
  if (!prev || prev.key !== key) return { key, dir: "asc" };
  if (prev.dir === "asc") return { key, dir: "desc" };
  return null;
}

/** Pure: produce the next URLSearchParams string after applying the given
 *  param ops. Values matching `dropIfEqualTo` are stripped so the canonical
 *  URL is param-free when filters are at their defaults. */
export function applyParamOps(
  current: URLSearchParams,
  ops: Array<{ key: string; value: string | string[] | null; dropIfEqualTo?: string }>,
): string {
  const next = new URLSearchParams(current.toString());
  for (const op of ops) {
    next.delete(op.key);
    if (op.value == null) continue;
    if (Array.isArray(op.value)) {
      for (const v of op.value) {
        if (v.length === 0) continue;
        if (op.dropIfEqualTo != null && v === op.dropIfEqualTo) continue;
        next.append(op.key, v);
      }
      continue;
    }
    if (op.value.length === 0) continue;
    if (op.dropIfEqualTo != null && op.value === op.dropIfEqualTo) continue;
    next.set(op.key, op.value);
  }
  return next.toString();
}

function useReplaceUrl(): (nextQuery: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  return React.useCallback(
    (nextQuery: string) => {
      const url = nextQuery.length > 0 ? `${pathname}?${nextQuery}` : pathname;
      router.replace(url, { scroll: false });
    },
    [router, pathname],
  );
}

/**
 * String param with a default. Reading `params.get(key)` falls back to
 * `defaultValue`; writing the default value strips the param from the URL.
 */
export function useUrlString<T extends string = string>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const params = useSearchParams();
  const replaceUrl = useReplaceUrl();
  const value = (params.get(key) ?? defaultValue) as T;
  const setValue = React.useCallback(
    (next: T) => {
      const qs = applyParamOps(params, [
        { key, value: next, dropIfEqualTo: defaultValue },
      ]);
      replaceUrl(qs);
    },
    [params, replaceUrl, key, defaultValue],
  );
  return [value, setValue];
}

/**
 * Boolean flag. Present param (any non-empty value) is read as `true`;
 * setting `false` drops the param. Canonical "on" value is `"1"`.
 */
export function useUrlBoolean(
  key: string,
): [boolean, (next: boolean) => void] {
  const params = useSearchParams();
  const replaceUrl = useReplaceUrl();
  const value = params.get(key) != null;
  const setValue = React.useCallback(
    (next: boolean) => {
      const qs = applyParamOps(params, [
        { key, value: next ? "1" : null },
      ]);
      replaceUrl(qs);
    },
    [params, replaceUrl, key],
  );
  return [value, setValue];
}

/**
 * Repeated string param — `?tag=foo&tag=bar` becomes `["foo", "bar"]`.
 * Setting an empty array strips the param. Order is preserved.
 */
export function useUrlStringList(
  key: string,
): [string[], (next: string[]) => void] {
  const params = useSearchParams();
  const replaceUrl = useReplaceUrl();
  // Memoised array identity so consumers can depend on it without re-running
  // effects on every parent render — the contents are stable as long as the
  // serialised form is.
  const value = React.useMemo(() => params.getAll(key), [params, key]);
  const setValue = React.useCallback(
    (next: string[]) => {
      const qs = applyParamOps(params, [{ key, value: next }]);
      replaceUrl(qs);
    },
    [params, replaceUrl, key],
  );
  return [value, setValue];
}

/**
 * Sort state encoded as `?<key>=<column>:<asc|desc>`. The third call on the
 * same column clears the sort (drops the param).
 */
export function useUrlSort(
  key: string,
  initial: SortState = null,
): [SortState, (column: string) => void] {
  const params = useSearchParams();
  const replaceUrl = useReplaceUrl();
  const raw = params.get(key);
  const value: SortState = raw != null ? decodeSort(raw) : initial;
  const toggle = React.useCallback(
    (column: string) => {
      const next = cycleSort(value, column);
      const qs = applyParamOps(params, [
        { key, value: encodeSort(next) },
      ]);
      replaceUrl(qs);
    },
    [params, replaceUrl, key, value],
  );
  return [value, toggle];
}

/**
 * Text input bound to a URL param with a debounced write. Returns the local
 * input value (snappy to type into), a setter for the input, and the
 * debounced value to feed the filter logic. The URL is only updated once
 * typing pauses, so a 10-character query produces one URL replace, not ten.
 *
 * Initial value comes from the URL on mount. External URL changes (e.g. back
 * navigation) sync into the local input UNLESS the user is actively typing
 * something different.
 */
export function useDebouncedUrlString(
  key: string,
  debounceMs = 200,
): [string, (next: string) => void, string] {
  const params = useSearchParams();
  const replaceUrl = useReplaceUrl();
  const urlValue = params.get(key) ?? "";
  const [inputValue, setInputValue] = React.useState(urlValue);
  const [debouncedValue, setDebouncedValue] = React.useState(urlValue);

  // External URL change → resync. We only adopt the new URL value when the
  // user isn't mid-edit on a different string; otherwise an in-flight debounce
  // would race the back-navigation and feel like the input "jumps back".
  React.useEffect(() => {
    if (urlValue === inputValue) return;
    if (urlValue === debouncedValue) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(urlValue);
    setDebouncedValue(urlValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlValue]);

  // Local debounce: when the input settles, push to the debounced value AND
  // to the URL. Strips the param when empty so the canonical URL is clean.
  React.useEffect(() => {
    if (inputValue === debouncedValue) return;
    const handle = window.setTimeout(() => {
      setDebouncedValue(inputValue);
      const qs = applyParamOps(params, [
        { key, value: inputValue.trim().length > 0 ? inputValue : null },
      ]);
      replaceUrl(qs);
    }, debounceMs);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  return [inputValue, setInputValue, debouncedValue];
}
