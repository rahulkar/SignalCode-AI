# TestLens Design System — Enterprise Minimalism

Inspired by Linear, Vercel, Stripe, Datadog. The product is a precision tool for engineers; the interface should disappear and let the data speak. Nothing decorative, no glass, no gradients, no marketing flourish.

## 1. Principles

1. **Data first.** Dense, scannable, tabular where appropriate. Whitespace is a tool, not a mood.
2. **Neutral canvas, one accent.** Grays do 95% of the work. Blue (`#2563eb`) is reserved for interactive affordances and active state.
3. **Flat surfaces, crisp borders.** 1px hairlines, no shadows on layout surfaces. Shadows only on popovers and modals (where they genuinely signal elevation).
4. **One type family.** A system-UI sans-serif. No display/body split. Monospace only for paths, commands, and code.
5. **Small radii.** 4–8px. No pills except for status badges that are explicitly discrete chips.
6. **Keyboard is first-class.** Everything actionable has a focus ring; destructive actions have confirmation; ⌘K leads navigation (future).
7. **Fail quietly.** Errors are inline, bordered, scoped. No toasts for expected errors. No decorative animation masking latency.

## 2. Color

### Light
| Role | Token | Value |
|---|---|---|
| Ground | `--surface-ground` | `#fafafa` |
| Card | `--surface-card` | `#ffffff` |
| Elevated | `--surface-elevated` | `#f5f5f5` |
| Hover | `--surface-hover` | `rgba(0,0,0,0.04)` |
| Border default | `--border-default` | `#e5e5e5` |
| Border strong | `--border-strong` | `#d4d4d4` |
| Border subtle | `--border-subtle` | `#ededed` |
| Text primary | `--text-primary` | `#0a0a0a` |
| Text secondary | `--text-secondary` | `#525252` |
| Text tertiary | `--text-tertiary` | `#737373` |
| Accent | `--interactive-primary` | `#2563eb` |
| Accent hover | `--interactive-primary-hover` | `#1d4ed8` |
| Success | `--color-success-500` | `#16a34a` |
| Warning | `--color-warning-500` | `#d97706` |
| Error | `--color-error-500` | `#dc2626` |

### Dark
| Role | Value |
|---|---|
| Ground | `#0a0a0a` |
| Card | `#111111` |
| Elevated | `#171717` |
| Border default | `#262626` |
| Border strong | `#333333` |
| Text primary | `#fafafa` |
| Text secondary | `#a3a3a3` |
| Text tertiary | `#737373` |
| Accent | `#3b82f6` |

**Rules**
- Never use more than one chromatic hue at once. Semantic colors (success/warning/error) only appear on status indicators, never on chrome.
- Avoid alpha compositing for borders except for hover states. Solid hairlines read cleaner at 1px.
- Dark mode is not inverted light mode. Dark surfaces climb in 1-step increments (`#0a0a0a` → `#111` → `#171717`); never use pure `#000`.

## 3. Typography

**Family**: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. No SF Pro Display. No Inter import (avoid network fonts in enterprise; system stack is fine and instantly available).

**Monospace**: `ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace` — used only for file paths, shell commands, code blocks.

**Scale** (compact, tabular-friendly):

| Role | Size | Weight | Line height | Use |
|---|---|---|---|---|
| Page heading | 20px | 600 | 1.3 | One per page at most |
| Section title | 14px | 600 | 1.4 | Card headers |
| Body | 13px | 400 | 1.5 | Primary reading size |
| Small | 12px | 400 | 1.45 | Metadata, help text |
| Caption | 11px | 500 | 1.4 | Labels, column headers (uppercase, tracked) |
| Mono | 12–13px | 400 | 1.5 | Paths, commands |

No weight above 600. No decorative letter-spacing. Uppercase only for eyebrow labels (`caption`).

## 4. Spacing & Radii

Base 4px. Canonical stops: **4, 8, 12, 16, 24, 32, 48**.

Radii:
- `--radius-sm` **4px** — badges, chips
- `--radius-md` **6px** — buttons, inputs, cards (default)
- `--radius-lg` **8px** — modals, popovers

No pill radius anywhere structural. Status dots and discrete chip shapes may use `9999px` locally.

## 5. Depth

| Level | Treatment | Use |
|---|---|---|
| 0 | Flat, 1px border | Cards, panels, topbar, sidebar |
| 1 | `0 1px 2px rgba(0,0,0,0.06)` | Popovers, dropdowns |
| 2 | `0 4px 12px rgba(0,0,0,0.08)` | Modals |
| Focus | `2px outline` at accent, 2px offset | All interactive elements |

No backdrop-filter. No radial gradients. No glass.

## 6. Components

### Buttons

Height 32px. Padding `0 12px`. Radius 6px. Font 13px / 500.

- **Primary**: `bg #2563eb / text #fff`. Hover `#1d4ed8`. Disabled `opacity .5`.
- **Secondary**: `bg transparent / 1px border #e5e5e5 / text #0a0a0a`. Hover `bg #f5f5f5`.
- **Ghost**: `bg transparent / text #525252`. Hover `bg rgba(0,0,0,.04)`.
- **Danger**: `bg transparent / 1px border #dc2626 / text #dc2626`. Hover `bg #fef2f2`.

No gradient backgrounds. No pill-shaped CTAs.

### Inputs

Height 32px. Radius 6px. 1px border default. Focus ring: 2px accent outline with 2px offset (no box-shadow glow). Placeholder color tertiary.

### Cards (`.glass-panel` — name preserved, look replaced)

`bg surface-card / 1px border default / 6px radius / no shadow`. Padding 16px default, 24px for primary regions.

### Topbar (`.glass-header` — name preserved)

Solid `surface-card` (not blurred). 1px bottom border. Height 48px. Sticky.

### Sidebar (new)

Width 240px (collapsible to 56px). `bg surface-ground`. 1px right border. Nav items: 32px tall, 13px/500, icon + label, 6px radius. Active = accent text + `surface-hover` bg + 2px left bar in accent.

### Status dots

6px circle. Colors:
- accent: running/in-progress
- success: green
- warning: amber
- error: red
- neutral: gray 400

### Badges

Chip: 18–20px tall, radius 4px, 11px/500, padding `0 6px`. Subtle tinted bg + matching text, no border.

### Tables

Header row: `bg surface-elevated / 11px / 500 / uppercase / tracked / bottom border`. Rows: 36px tall, bottom 1px divider. Hover row: `surface-hover`. Zebra off by default.

## 7. Layout

App shell:

```
┌───────┬────────────────────────────────────────────────┐
│       │  Topbar (48)                                   │
│ Side  ├────────────────────────────────────────────────┤
│ bar   │                                                │
│ (240) │   Main content (max-width 1280, px 24)         │
│       │                                                │
└───────┴────────────────────────────────────────────────┘
```

Content container centers at `max-w-[1280px]` with `24px` horizontal gutters. Right inspector panel (for chat, insight) slides in as an overlay or pinned column at `360px` — no floating docks.

## 8. Motion

One transition: `150ms ease-out` for hover/focus. Modal/drawer: `180ms cubic-bezier(.2,.8,.2,1)`. **No stagger animations on content mount.** No bounce, no pulse on decorative elements. Spinners allowed only where actually loading.

## 9. Don'ts

- No glass / backdrop blur / gradients / colored shadows
- No pill buttons / 980px radii
- No SF Pro Display-sized hero text (anything above 24px)
- No multiple accent colors
- No decorative icons in headings
- No emoji in product UI
- No "Apple Blue" language — we call it "accent"
