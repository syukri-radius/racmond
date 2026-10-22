"use client";

import { useEffect } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { useTheme } from "@/store/theme";

/**
 * Keeps the React store in sync with the pre-hydration attribute written by
 * THEME_INIT_SCRIPT and mirrors OS-level changes while the operator has not
 * made an explicit choice.
 */
export function ThemeWatcher() {
  useEffect(() => {
    useTheme.getState().hydrate();

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (event: MediaQueryListEvent) => {
      let hasChoice = false;
      try {
        hasChoice = window.localStorage.getItem(THEME_STORAGE_KEY) !== null;
      } catch {
        /* ignore */
      }
      if (hasChoice) return;
      useTheme.getState().adoptTheme(event.matches ? "light" : "dark");
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return null;
}
