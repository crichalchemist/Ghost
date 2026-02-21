# PrivateStack Main Site Theme Design

**Goal:** Apply the PrivateStack visual identity to the main Ghost site using the Source theme's built-in customization settings.

**Approach:** Configure via Ghost Admin API — no code changes or theme fork needed.

---

## Visual Identity

From the original design doc (`2026-02-10-privatestack-design.md`):

- Dark mode default (privacy aesthetic)
- Bitcoin orange accent color
- Minimalist, technical feel
- No corporate polish — grassroots authenticity

## Settings Applied

| Setting | Value | Rationale |
|---------|-------|-----------|
| Site background color | `#0d1117` | Dark mode — GitHub-dark palette, easy on the eyes |
| Accent color | `#f7931a` | Bitcoin orange — brand identity |
| Title font | Consistent mono (JetBrains Mono) | Technical/hacker aesthetic |
| Body font | Modern sans-serif (Inter) | Clean readability |
| Header style | Landing | Bold tagline statement |
| Header text | "Private publishing. Bitcoin payments. Your content, uncensored." | From approved tagline options |
| Post feed style | Grid | Visual card layout for content discovery |
| Navigation layout | Logo on the left | Standard, clean |
| Header/footer color | Background color | Unified dark appearance |
| Show publication info sidebar | true | Site context for visitors |
| Site title | PrivateStack | Brand name |
| Site description | The privacy-first publishing platform | Subtitle |

## Future Work (Requires Source Fork)

These items are **not** part of this configuration pass:

- Dual accent colors (Bitcoin orange + Ghost blue) — Source supports only one
- Custom payment method selector on signup page
- Bearer token display page
- Bitcoin/Lightning icons in navigation
