"use client";

import * as React from "react";
import Script from "next/script";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "nomly.theme";
const DEFAULT_THEME: Theme = "dark";

type ThemeCtx = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const Ctx = React.createContext<ThemeCtx | null>(null);

/**
 * Inline FOUC-prevention script. Rendered server-side from
 * `<ThemeInitScript />` so React 19's "no scripts in client components"
 * warning doesn't fire. Sets the `light`/`dark` class on `<html>` from
 * localStorage before the React tree hydrates.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=document.documentElement;var t=localStorage.getItem('${STORAGE_KEY}')||'${DEFAULT_THEME}';var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;s.classList.remove('light','dark');s.classList.add(r);}catch(e){}})();`;

/**
 * Goes through next/script so React 19's "scripts inside React components"
 * warning doesn't fire — `next/script` wraps the tag in its own runtime
 * which doesn't trip the same heuristic. `beforeInteractive` runs the
 * snippet before hydration so the theme class is on `<html>` before the
 * first paint.
 */
// `beforeInteractive` ensures the snippet runs before hydration so the
// theme class is on `<html>` before the first paint. The lint rule predates
// the App Router and still references `pages/_document.js`; in
// app/layout.tsx this strategy is officially supported.
/* eslint-disable @next/next/no-before-interactive-script-outside-document */
export function ThemeInitScript() {
  return (
    <Script id="nomly-theme-init" strategy="beforeInteractive">
      {THEME_INIT_SCRIPT}
    </Script>
  );
}
/* eslint-enable @next/next/no-before-interactive-script-outside-document */

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return DEFAULT_THEME === "light" ? "light" : "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server / first-client render: assume the default so the React tree
  // matches the SSR HTML. The inline FOUC script has already set the
  // correct class on `<html>`; we sync our state with localStorage in an
  // effect after hydration.
  const [theme, setThemeState] = React.useState<Theme>(DEFAULT_THEME);
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(
    DEFAULT_THEME === "light" ? "light" : "dark",
  );

  // Hydrate from localStorage exactly once after mount, then keep
  // `<html>`'s class + state in sync whenever the user changes the theme.
  React.useEffect(() => {
    const stored = readStoredTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(stored);
  }, []);

  React.useEffect(() => {
    const next = resolveTheme(theme);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolvedTheme(next);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(next);
    // When the user picks "system", listen for OS-level changes so the
    // app follows along.
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const t: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolvedTheme(t);
      root.classList.remove("light", "dark");
      root.classList.add(t);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Ignore quota / unavailable localStorage — the class on `<html>`
      // still updates via the effect above.
    }
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    // Match next-themes' tolerant behaviour: callers expect a shape, not
    // a thrown error during SSR.
    return {
      theme: DEFAULT_THEME,
      resolvedTheme: DEFAULT_THEME === "light" ? "light" : "dark",
      setTheme: () => undefined,
    };
  }
  return ctx;
}
