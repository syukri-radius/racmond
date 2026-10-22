export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "racmond-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

/**
 * Resolves the theme that should be active on first paint:
 * explicit operator choice → OS preference → dark.
 */
export function resolveInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* storage blocked — fall through to the OS preference */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode: the choice simply does not survive the session */
  }
}

/**
 * Runs before hydration (inlined in <head>) so the first paint already uses the
 * stored theme — no white flash, no layout shift.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}";var s=localStorage.getItem(k);var t=s==="light"||s==="dark"?s:(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;}catch(e){}})();`;
