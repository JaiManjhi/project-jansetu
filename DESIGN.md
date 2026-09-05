# Design System — JanSetu

## 1. Philosophy

The reference points are Stripe, Linear, Notion, Arc Browser, Raycast — restrained, confident, typography-led interfaces that never lean on decoration to look finished. This is a government-facing civic platform, so it must also read as credible and calm, not like a startup landing page.

**Explicitly banned:** gradient backgrounds as decoration, glassmorphism, emoji used as icons, stock illustration of generic diverse people shaking hands, a generic centered-hero-with-blob-shapes layout, purple-to-blue gradient buttons, any visual pattern that reads as "default AI-generated SaaS site."

## 2. Color

Avoid a literal tricolor cliché (no saffron-white-green banding). Instead, a restrained palette that nods to it without being kitsch:

| Token | Hex | Use |
|---|---|---|
| `--ink-900` | `#14151A` | Primary text, headers |
| `--ink-600` | `#4A4D57` | Secondary text |
| `--ink-300` | `#9AA0AC` | Placeholder, disabled |
| `--paper` | `#FAFAF8` | Base background — warm off-white, not stark white |
| `--surface` | `#FFFFFF` | Card/panel background |
| `--border` | `#E4E4E0` | Hairline borders |
| `--accent` | `#1F3F77` | Primary accent — the logo's navy. Primary CTA, active states, links, key data points. 9.87:1 on `--paper`. Never as a full-panel background |
| `--accent-subtle` | `#EDF2FA` | Accent tint, for selected/hover backgrounds |
| `--success` | `#2E7D32` | Resolved/claimed states. Text-safe green (4.91:1) — NOT the logo's brighter green, which fails AA |
| `--severity` | `#B85C0A` | High-severity badges, white text on solid only (4.59:1). Never body text |
| `--success` | `#1E7A4C` | Confirmations, matched status |
| `--warning` | `#B8860B` | Pending, needs-review states |
| `--danger` | `#B3261E` | Errors, high-severity flags |

> **✅ Conflict resolved — 2026-09-05.** The palette now derives from the logo, and
> the decision was made on measured contrast rather than taste.
>
> `--accent` is the logo's navy `#1F3F77`, which scores **9.87:1** on the page
> background — comfortably past WCAG AA, and higher than the terracotta it
> replaces (4.32:1, which failed AA for body text and had been a latent
> accessibility defect, not merely a mismatch).
>
> The logo's own green and orange **cannot be used for text**: measured 3.38:1
> and 2.63:1 respectively. They appear in the logo mark only. Their text-safe
> equivalents are `--success #2E7D32` (4.91:1) and `--severity #B85C0A`
> (4.59:1 as white-on-solid, so badges only, never body text).
>
> This matters beyond taste: **GIGW 3.0**, the mandatory standard for Indian
> government websites, requires conformity with WCAG 2.1 Level AA. A civic
> portal that fails contrast is not merely ugly, it is non-compliant.
>
> **The admin heat ramp deliberately stays warm.** Migrating the accent to navy
> raised the question of retuning it. It should not be retuned: the ramp encodes
> report density, not brand, and warm-for-many is a convention a reader already
> knows before they arrive. A navy-on-navy heatmap would be on-brand and harder
> to read, which is the wrong trade for a map an administrator uses to decide
> where to send attention.
>
> > The §1 note on the logo's circle-of-figures motif stands: the banned pattern is
> stock illustration used as page decoration, which the app does not do. The logo
> is a mark, and appears as one.

Dark mode: invert to an ink-950 background (`#0E0F13`), not pure black. Ship dark mode only if Day 9-10 has slack — it is not required for the demo to succeed.

## 3. Typography

> **Typeface changed to Noto — 2026-09-05.** Inter has no Devanagari, Bengali or
> Odia glyphs. The app ships translation into all four scripts, so every
> translated report was rendering in whatever fallback the reader's OS happened
> to supply — different on Android, iOS and Windows, and occasionally tofu boxes.
> That is a correctness bug in a multilingual product, not a styling preference.
>
> **Noto Sans** for UI and body, with `Noto Sans Devanagari`, `Noto Sans Bengali`
> and `Noto Sans Oriya` in the stack for the scripts JanSetu supports.
> **Noto Serif** for display headings, replacing Fraunces — it shares the Noto
> metrics and covers the same scripts, so a Hindi heading sets like an English
> one.
>
> This also happens to be what the Government of India's **Digital Brand Identity
> Manual** requires: "Government entities must use Noto Sans scripts." Compliance
> and correctness point the same way here.
>
> The Indic faces load with `preload: false` — they are only needed once a reader
> asks for a translation, and this app is used on rural connections where
> preloading four font families would be indefensible.

- **UI/body:** Inter or Geist — clean, neutral, excellent at small sizes for dashboards
- **Headings/display:** a distinct serif or grotesque for section headers only (e.g., a title like "Report a Problem") to avoid the generic all-sans-everything look every AI-generated site has. Something like Fraunces or Newsreader at large sizes works well against the sans body — pick one, use consistently
- **Scale:** 12 / 14 / 16 / 20 / 24 / 32 / 48px. Don't invent sizes outside this scale.
- **Line height:** 1.5 for body text, 1.2 for headings

## 4. Spacing

4px base unit. Use the scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. Never an arbitrary value like 13px or 22px.

## 5. Components

- **Cards:** `--surface` background, 1px `--border`, 12px corner radius, no shadow at rest — a subtle shadow only on hover/interactive cards. Flat, not floaty.
- **Buttons:** solid `--accent` for primary, outline `--border` for secondary, no gradient fills ever. 8px corner radius.
- **Forms:** generous input height (44px minimum, touch-target friendly — citizens are on phones), visible focus rings in `--accent`, inline validation, not just on-submit.
- **Empty states:** a short, specific sentence + one clear action. No stock illustration.
- **Loading states:** skeleton screens over spinners wherever a layout shape is known in advance (dashboard cards, lists); a simple inline spinner only for indeterminate actions (submitting a form).

## 6. Icons

Lucide or Phosphor, line-style only, 1.5px stroke weight, consistent size (20px in UI chrome, 16px inline with text). Never an emoji standing in for an icon anywhere in the product UI (the internal doc set can use emoji freely — the product cannot).

## 7. Motion (Framer Motion)

Motion is purposeful, not decorative. Use it for:
- Page/route transitions — a subtle 150-200ms fade+slight-slide, nothing bouncy
- The dedup-detection moment on citizen submit — this is a genuine "aha" UI moment worth a deliberate, visible transition (the duplicate card animating in, not just appearing)
- List item entry on the admin dashboard when data loads

Do not use motion for: buttons on hover (a color transition is enough), decorative background elements, anything that delays a user's ability to act.

## 8. Layout patterns

- **Citizen flow:** mobile-first, single-column, large touch targets, minimal chrome. This is a form a low-literacy user fills standing in a field — every screen should have one obvious next action.
- **Location capture — the Zomato/Swiggy pattern, specifically:** on opening the location step, request GPS immediately and pre-fill the pin the moment it resolves — don't wait for a tap. Show the pin on a MapLibre map with a persistent, equally-prominent **"Set location manually"** button beside it, not buried in a menu or only surfaced after GPS fails. Tapping it lets the citizen drag the pin freely — this covers reporting on behalf of someone else, reporting a remembered location while not physically there, or GPS drift in dense urban/hilly terrain. Whichever path is used, show a small confirmation label under the pin — "Using your current location" vs. "Location set manually" — so the citizen (and later, the data) is never ambiguous about which happened.
- **University/Industry dashboards:** desktop-first is acceptable but must degrade gracefully to tablet — coordinators may check this on the move.
- **Admin dashboard:** desktop-first, information-dense is acceptable here (this is the "serious government tool" screen), but still respects the spacing scale and never gets visually noisy. Consider a subtle visual distinction (e.g. marker opacity or a small icon) between GPS-verified and manually-placed points on the heatmap — an admin reviewing data quality should be able to tell them apart without opening every record.

## 9. Accessibility minimums

- Color contrast AA minimum on all text
- Every form input has a visible label, not placeholder-as-label
- Voice input has a visible, obvious mic button with a clear recording state
- All interactive elements reachable and operable via keyboard

## 10. The one-sentence test

Before shipping any screen, ask: does this look like it was built by a team that cared, or does it look like the fifteenth AI-generated dashboard a judge has seen today? If in doubt, remove decoration rather than add it.
