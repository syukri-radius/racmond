# HELIOS OPS — Theme system (dark / light purple glassmorphism)

The dashboard ships two themes that share **one** token contract. Both are built on the
company purple: the dark theme is a violet-black "control room", the light theme is a
lavender-white glass surface.

```
<html data-theme="dark">   ← default
<html data-theme="light">  ← operator choice or OS preference
```

---

## 1 · Files

| file | responsibility |
| --- | --- |
| `src/app/globals.css` | every design token (`--ink-*`, `--fg-*`, `--accent`, `--type-*`, `--glass-*`, `--metric-*`), base styles, glass recipes, animations |
| `src/lib/theme.ts` | `Theme` type, storage key, first-paint resolver, `applyTheme`, the inline `<head>` script |
| `src/store/theme.ts` | zustand store (`theme`, `setTheme`, `adoptTheme`, `toggleTheme`, `hydrate`) |
| `src/components/theme/ThemeToggle.tsx` | the pill button in the top bar / guide header |
| `src/components/theme/ThemeWatcher.tsx` | hydration + `prefers-color-scheme` listener |
| `src/components/guide/Mermaid.tsx` | re-initialises and re-renders diagrams with the matching Mermaid palette |

---

## 2 · No flash on load

`layout.tsx` inlines `THEME_INIT_SCRIPT` in `<head>`:

1. read `localStorage["racmond-theme"]`;
2. otherwise use `prefers-color-scheme`;
3. write `document.documentElement.dataset.theme` **and** `color-scheme`.

This runs before the first paint, so there is no dark → light flash. The React store starts
at `"dark"` (matching SSR) and hydrates from the attribute in an effect, which keeps
hydration deterministic. The toggle's icon/label swap is CSS-driven
(`[data-theme="light"] .theme-sun { … }`) so the control is correct even before hydration.

---

## 3 · Token contract

### Surfaces — `--ink-*`

| token | dark | light | used for |
| --- | --- | --- | --- |
| `--ink-950` | `#08040f` | `#f7f3ff` | page / deepest inset |
| `--ink-900` | `#0d0819` | `#fdfbff` | panels |
| `--ink-850` | `#130c24` | `#f3ecff` | raised tiles |
| `--ink-800` | `#19112f` | `#ece2fd` | active segments |
| `--ink-750` | `#20163d` | `#e2d5f9` | tracks |
| `--ink-700` | `#291c4c` | `#d5c5f4` | strongest neutral |
| `--line` | `rgba(176,146,255,.16)` | `rgba(109,40,217,.18)` | borders / dividers |
| `--line-soft` | `rgba(176,146,255,.08)` | `rgba(109,40,217,.10)` | inner dividers |

Tailwind classes `bg-ink-950 … bg-ink-700`, `border-line`, `border-line-soft` are generated
from these variables (`@theme inline`), so they flip with the theme.

### Text — the adaptive neutral ramp

Rather than rewriting hundreds of `text-slate-*` classes, the **slate scale itself** is
theme aware. The light theme inverts its lightness so `text-slate-100` is near-black and
`text-slate-600` is a muted purple-grey, while every existing component keeps working.

| utility | dark | light |
| --- | --- | --- |
| `slate-50` | `#faf7ff` | `#0d0617` |
| `slate-100` | `#f2ecfd` | `#1a1029` |
| `slate-200` | `#e2d8f8` | `#2a1b3f` |
| `slate-300` | `#c8b9e3` | `#40304f` |
| `slate-400` | `#a794c6` | `#5c4a72` |
| `slate-500` | `#82719f` | `#6f5b87` |
| `slate-600` | `#64537f` | `#7d6a95` |
| `slate-700` | `#4c3d66` | `#a698b8` |

Status accents used as text (`emerald/amber/rose/sky/violet/indigo/teal/cyan/blue-200/300/400`)
are likewise re-mapped to darker steps in the light theme, so `text-emerald-300` stays
readable on white while `bg-emerald-500/10` washes keep their AA-friendly hue.

### Purple accent — `--accent`

| token | dark | light |
| --- | --- | --- |
| `--accent` (exposed as `ice`) | `#c4b5fd` | `#6d28d9` |
| `--accent-strong` | `#a78bfa` | `#5b21b6` |
| `--accent-deep` | `#7c3aed` | `#4c1d95` |

`text-ice`, `border-ice/30`, `bg-ice/[0.07]` are the primary interactive accent everywhere.

### Node types — `--type-*`

Fourteen accents (`--type-org`, `--type-division`, … `--type-resource`) drive the left rail,
the icon, the card tint and the collapse chevrons. Light theme uses deeper variants of the
same hues (`#7c3aed`, `#0284c7`, `#059669`, …).

### Glass recipe — `--glass-*`

| token | dark | light |
| --- | --- | --- |
| `--glass-bg` | `rgba(21,13,38,.55)` | `rgba(255,255,255,.64)` |
| `--glass-bg-strong` | `rgba(13,8,25,.72)` | `rgba(255,255,255,.80)` |
| `--glass-inset` | `rgba(32,22,61,.45)` | `rgba(255,255,255,.58)` |
| `--glass-border` | `rgba(196,181,253,.14)` | `rgba(109,40,217,.16)` |
| `--glass-highlight` | `rgba(255,255,255,.06)` | `rgba(255,255,255,.95)` |
| `--glass-blur` | `22px` | `22px` |

Utility classes (all in `@layer components`, so Tailwind utilities can still override them):

| class | use |
| --- | --- |
| `glass-bar` | top bar, event dock — stronger fill, header sheen |
| `glass-panel` | left rail, inspector — the main frosted columns |
| `glass-card` | cards, mermaid figures, code blocks |
| `glass-chip` | floating canvas chrome, error toasts |
| `glass-chip` / `glass-inset` | stat tiles, action buttons, inputs |
| `node-surface` | canvas node cards (tinted per `--type-*`, `data-group="true"` variant) |

Every panel/chrome glass surface = translucent fill + `backdrop-filter: blur() saturate()` +
lavender border + `inset 0 1px 0` highlight + long soft shadow. A decorative aurora layer in
`layout.tsx` (three blurred purple orbs, `prefers-reduced-motion` aware) gives the blur
something to refract.

Canvas node cards intentionally skip `backdrop-filter`: with a 450-node estate that is
hundreds of blur layers and a stalled compositor. They keep the tint gradient, translucency,
highlight and shadow, which reads as glass at canvas scale; the blur budget is spent on the
dozen real surfaces (top bar, dock, rails, inspector, chips, cards).

---

## 4 · Usage

```tsx
import { useTheme } from "@/store/theme";

const theme = useTheme((s) => s.theme);        // "dark" | "light"
useTheme.getState().toggleTheme();             // flips + persists
useTheme.getState().setTheme("light");         // explicit choice (persisted)
useTheme.getState().adoptTheme("light");       // follow OS, not persisted
```

CSS-only theming (no JS needed):

```css
.my-thing { background: var(--ink-900); color: var(--fg-100); border: 1px solid var(--line); }
[data-theme="light"] .my-thing { /* only when a light-only tweak is required */ }
```

---

## 5 · Rebranding

Because both themes read the same variables, changing the company colour is a value change:

1. edit `--page-glow-*`, `--accent*` in both blocks of `globals.css`;
2. optionally retune `--type-*` accents;
3. never hardcode a hex in a component — use a token or one of the `*TONE` maps in
   `src/lib/graph.ts`.

---

## 6 · Accessibility / performance notes

* `color-scheme` is set per theme, so native scrollbars, form controls and
  `accent-color` checkboxes follow automatically.
* All text tokens are chosen for ≥ 4.5:1 on their intended surface (small mono labels use
  the `-500` step, decorative micro-copy the `-600`).
* Theme switching only mutates custom properties — no re-layout of the ELK canvas, and the
  scene graph is unaffected.
* Animations (aurora drift, pulse, sweep, blink) are disabled under
  `prefers-reduced-motion: reduce`.
