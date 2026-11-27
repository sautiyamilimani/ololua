# Ololua MIS Design System

## Purpose

This document is the visual and interaction reference for Ololua MIS. It describes
a calm, native-app-style web experience for customers on Android phones and for
staff on laptops or tablets.

The public URL initially returned HTTP 404, but the supplied page source provides
the actual Ololua visual reference. Use the attached index and login source
styles as the brand baseline: deep navy, aqua, teal, Inter typography, rounded
cards and calm water effects. Do not add unseen company data or external assets
that are not already present in approved project configuration.

## Brand direction

- Premium, calm, trustworthy and aquatic.
- Use water as a functional visual language, not decoration.
- Prefer compact native-app patterns over open-ended desktop dashboard layouts.
- Preserve clarity for outdoor use and on mid-range Android devices.
- Keep the interface online-only; never promise offline data or payment support.

## Tokens

The canonical CSS variables are defined in `src/app/globals.css`.

| Purpose | Variable | Use |
| --- | --- | --- |
| Primary text | `--ink` | Headings and important body text |
| Secondary text | `--muted` | Labels and supporting text |
| Page background | `--paper` | Application canvas |
| Card surface | `--surface` | Cards and native panels |
| Borders | `--line` | Dividers and input boundaries |
| Primary action | `--blue` | Buttons and selected controls |
| Water accent | `--teal` | Action gradients and highlights |
| Dark shell | `--deep`, `--navy` | Desktop navigation and auth atmosphere |
| Success | `--ok`, `--ok-bg` | Paid, active and completed states |
| Warning | `--warn`, `--warn-bg` | Pending or overdue attention |
| Error | `--err`, `--err-bg` | Validation and failure states |
| Motion | `--ease`, `--dur-fast`, `--dur` | Consistent transitions |

Components must use CSS variables. New screen work must not introduce ad-hoc
colour palettes or a second set of status colours.

## Typography

- Use Inter through `next/font/google`; Next.js serves the font locally.
- Headings use 800 weight, tight tracking and a 1.12 line-height.
- Body text uses 400 to 500 weight and 1.6 line-height.
- Labels use 600 to 700 weight.
- Money, readings and dates use tabular numerals.
- Scale the root font at 1200px, 1500px and 1900px while widening the content
  maximum as screen size grows.

## Native-app layout

### Mobile

- Start from a 360px viewport.
- Use a compact sticky header with safe-area top spacing.
- Use a fixed 4-item bottom navigation on phone widths.
- Give the bottom navigation safe-area bottom spacing and reserve content padding
  below it.
- Use 28px card radii, 14px input radii and 999px primary actions.
- Use at least 44px controls; preferred input and primary button height is 50px
  or 52px.
- Keep the main content in a narrow, readable column and avoid horizontal
  page scrolling.

### Desktop

- Use a left navigation rail or drawer, a compact sticky top bar and a restrained
  content canvas.
- Do not recreate a wide generic analytics dashboard.
- Keep tables readable and replace dense actions with menus or explicit forms.

## Components

Use these shared visual behaviours:

- **Card:** solid white surface, 24 to 28px radius and a soft navy-tinted shadow.
- **Primary button:** blue-to-teal gradient, white text and pill shape.
- **Secondary button:** white surface, `--line` border and `--ink` text.
- **Input:** visible label, 50px mobile height, 14px radius and an associated
  error or helper message.
- **Status:** pair a status colour with an icon and text label.
- **Profile/quick access:** use a round avatar or icon disc, a short label and
  a bold value.
- **Bottom sheet/dialog:** use for mobile confirmations and selections; trap
  focus and close on Escape. Destructive and consequential confirmations should
  use the shared `useConfirmationDialog` component in
  `src/components/ui/confirmation-dialog.tsx`, not browser-native confirm
  popups. Keep the action on hold until the user confirms; cancellation and
  Escape must leave it unchanged.
- **Toast:** display operation success and error messages in one shared,
  viewport-fixed notification layer mounted at the app root. Success and
  ordinary errors dismiss after five seconds; network errors remain until
  dismissed. Keep field-level validation attached to its input.
- **Loading:** skeletons for lists/cards and a small water drop affordance for
  page-level work.
- **Empty/error:** simple water illustration, plain-language explanation and
  one clear action.

## Motion

- Animate only `transform` and `opacity`.
- Use `--ease` for all transitions.
- Use 150ms for press and hover, 250ms for most transitions and 450ms for
  entrances.
- Do not loop motion near forms or reading content.
- `prefers-reduced-motion: reduce` must provide a static equivalent.

## Water effects

- `<WaterGlass>` is an auth-only canvas showing condensation, restrained downward
  drops and a gently waving pool.
- The canvas pauses when the browser tab is hidden, caps pixel density and reduces
  drop count on mobile.
- `<Ripple>` provides pointer feedback on primary actions. It is disabled under
  `prefers-reduced-motion: reduce`.
- Water motion stays behind reading content and never loops near form fields.

## Authentication

- Use a deep navy background and a solid white, rounded sign-in panel on mobile.
- The logo and one-line description remain visible above the form.
- Inputs use 16px text on mobile to avoid automatic zoom.
- Errors explain what happened and what to do next.
- Failed sign-in must remain generic and must not expose account existence.
- Sessions use secure cookies and route protections remain server-side.

## Localisation

- Currency: KES with `Intl.NumberFormat("en-KE")`.
- Time zone: `Africa/Nairobi`.
- Phone numbers: `+254` international format.
- Water usage: display cubic metres as `m³`.
- Never invent customer data, tariffs, addresses, contacts or status values.

## Accessibility

- Maintain WCAG 2.2 AA text and control contrast.
- Every icon control needs an accessible name.
- Every form field needs a persistent label and `aria-describedby` when helper or
  error text exists.
- Touch targets are at least 44px.
- Preserve logical keyboard order and visible focus.
- Status is never conveyed by colour alone.

## Responsive verification

Check every redesigned screen at 360px, 390px, 768px, 1024px, 1440px and
1920px. Verify that there is no horizontal page scrolling and that fixed bars
do not overlap active controls.

## Mandatory screenshot test

Every UI edit or new UI component is incomplete until screenshot verification
has been performed on a reachable local application.

Minimum evidence:

- 360px mobile.
- 390px mobile.
- One tablet width, normally 768px or 1024px.
- 1440px desktop.

When affected, test expanded, open, loading, empty, error, success and disabled
states as well. Inspect screenshots for overlap, clipping, cramped controls,
horizontal overflow and contrast. Record screenshots or their exact saved paths,
the tested URL, viewport sizes and pass/fail result in `PROJECT_PROGRESS.md`.

Code checks alone do not prove that a UI component works.
