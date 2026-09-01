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
| `--accent` | `#C1571F` | Primary accent — a muted, terracotta-leaning saffron. Used sparingly: primary CTA, active states, key data points. Never as a full-panel background |
| `--accent-subtle` | `#FDF1E7` | Accent tint, for selected/hover backgrounds |
| `--success` | `#1E7A4C` | Confirmations, matched status |
| `--warning` | `#B8860B` | Pending, needs-review states |
| `--danger` | `#B3261E` | Errors, high-severity flags |

Dark mode: invert to an ink-950 background (`#0E0F13`), not pure black. Ship dark mode only if Day 9-10 has slack — it is not required for the demo to succeed.

## 3. Typography

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
