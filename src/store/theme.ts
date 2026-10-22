"use client";

import { create } from "zustand";
import { applyTheme, isTheme, persistTheme, resolveInitialTheme, type Theme } from "@/lib/theme";

interface ThemeState {
  theme: Theme;
  hydrated: boolean;
  /** syncs React state with the attribute written by the pre-hydration script */
  hydrate: () => void;
  setTheme: (theme: Theme) => void;
  /** applies a theme without persisting it (used for OS-level preference) */
  adoptTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "dark",
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const current = document.documentElement.dataset.theme;
    const theme = isTheme(current) ? current : resolveInitialTheme();
    applyTheme(theme);
    set({ theme, hydrated: true });
  },

  setTheme: (theme) => {
    applyTheme(theme);
    persistTheme(theme);
    set({ theme, hydrated: true });
  },

  adoptTheme: (theme) => {
    applyTheme(theme);
    set({ theme, hydrated: true });
  },

  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
