# DESIGN.md

## World

A calm enterprise collaboration surface with a pink-white material language. It should feel closer to a mature product workspace than a creative agency site: restrained rose accents, neutral type, crisp structure, and visible collaboration states.

## Palette

| Token | Value | Role |
|---|---|---|
| `--canvas` | `#f8f5f6` | Main workspace surface |
| `--surface` | `#fffdfd` | Windows, rail, and code drawer |
| `--ink` | `#2b262c` | Primary text |
| `--muted` | `#756c72` | Secondary text |
| `--rose` | `#b95b73` | Restrained brand accent |
| `--rose-deep` | `#783b4c` | Primary actions and selected tools |
| `--rose-weak` | `#f1dce2` | Selected states and soft fills |
| `--sage` | `#8fa18c` | Live / success status only |
| `--line` | `#e4dbde` | Hairlines and dividers |

No neon, cyber-dark theme, saturated pink canvas, gradient text, or decorative blur.

## Typography

- UI and display: **Onest Variable** — professional, human, and less category-default.
- Code and spreadsheet coordinates: monospace only where the content is technical.

## Composition

- White topbar with product identity, workspace breadcrumb, room state, presence, and actions.
- Slim persistent tool rail on the left.
- The Coact canvas is the main product surface, not a marketing hero.
- Windows, image frames, and spreadsheet surfaces feel like parts of one collaborative document.
- Mobile converts the rail into a compact bottom tool bar.

## Motion

- Initial windows settle once.
- Remote drag and resize never re-trigger decorative animation.
- Cursor movement is smooth and linear.
- Status changes are quiet.
- Reduced-motion users receive instant transitions.

## Depth

- Hairline borders.
- Low-contrast offset shadows.
- Flat neutral surfaces with restrained pink emphasis.
- No glassmorphism or floating decorative gradients.

## Canvas objects

- Image frames are compact artboards with a shared prompt and a deterministic placeholder renderer.
- Spreadsheets use a quiet grid, tabular numerals, formula bar, and muted peer-selection outlines.
- Both feel operational and document-like rather than playful widgets.

## Component tokens

All visual values are exposed through CSS custom properties on `<coact-room>`.
