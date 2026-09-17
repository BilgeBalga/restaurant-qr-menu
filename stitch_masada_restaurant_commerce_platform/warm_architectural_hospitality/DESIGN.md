---
name: Warm Architectural Hospitality
colors:
  surface: '#f8f9ff'
  surface-dim: '#d0dbed'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dee9fc'
  surface-container-highest: '#d9e3f6'
  on-surface: '#121c2a'
  on-surface-variant: '#5a413b'
  inverse-surface: '#27313f'
  inverse-on-surface: '#eaf1ff'
  outline: '#8e706a'
  outline-variant: '#e3beb7'
  surface-tint: '#b3290f'
  primary: '#b0260c'
  on-primary: '#ffffff'
  primary-container: '#d33f24'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb4a5'
  secondary: '#575e70'
  on-secondary: '#ffffff'
  secondary-container: '#d9dff5'
  on-secondary-container: '#5c6274'
  tertiary: '#006948'
  on-tertiary: '#ffffff'
  tertiary-container: '#00855d'
  on-tertiary-container: '#f5fff7'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad3'
  primary-fixed-dim: '#ffb4a5'
  on-primary-fixed: '#3e0500'
  on-primary-fixed-variant: '#8d1500'
  secondary-fixed: '#dce2f7'
  secondary-fixed-dim: '#c0c6db'
  on-secondary-fixed: '#141b2b'
  on-secondary-fixed-variant: '#404758'
  tertiary-fixed: '#85f8c4'
  tertiary-fixed-dim: '#68dba9'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#f8f9ff'
  on-background: '#121c2a'
  surface-variant: '#d9e3f6'
typography:
  display:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.03em
  display-mobile:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.03em
  currency-display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 1.5rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style

This design system establishes a high-trust, mobile-first transaction experience bridging physical dining with immediate digital settlement. The aesthetic harmonizes the reductionist precision of Nordic fintech with the tactile, sun-baked warmth of high-end Mediterranean and Aegean hospitality. 

Rather than clinical utility or loud promotional dining apps, the interface mirrors a physical leather billfold and architectural slate table surfaces: quiet, respectful, and razor-sharp. Visual hierarchy remains exceptionally disciplined. Deep charcoal type rests on porcelain and chalk surfaces, accented strictly by a focused terracotta stroke to pull the eye toward primary payment and order commitments. The tone conveys frictionless financial confidence, operational immediacy, and discreet luxury.

## Colors

The color palette centers on functional restraint and high contrast for variable indoor/outdoor restaurant lighting conditions (e.g., dim bistros to sunlit terraces).

- **Primary (`#E24A2D`)**: Warm Terracotta. Reserved strictly for conversion-driving actions (Pay Bill, Confirm Order, Tip selection, primary buttons) and active tab indicators. Never used for generic backgrounds or low-priority decorative elements.
- **Secondary (`#111827`)**: Deep Charcoal. Functions as the foundational anchor for typography, structural icons, and high-emphasis controls to preserve an authoritative, premium feel.
- **Tertiary (`#059669`)**: Emerald. Applied deliberately to settlement confirmations, validated payments, and positive balance states.
- **Supporting Semantic Accents**: Amber (`#D97706`) signals kitchen preparation and pending authorizations; Slate (`#6B7280`) controls inactive states and muted metadata.
- **Canvas & Neutrals**: Base canvas relies on Crisp Off-White (`#F9FAFB`) with Pure White (`#FFFFFF`) card containers. Architectural separation is achieved using subtle border dividers (`#E5E7EB` and `#F3F4F6`), avoiding dark dividing lines.

## Typography

Typography relies entirely on Inter to deliver Apple-grade rendering fidelity, geometric purity, and precise optical alignment on high-density mobile displays. 

Numerical figures, totals, and Turkish Lira (`₺`) amounts utilize tabular figures (`font-variant-numeric: tabular-nums`) to preserve clean vertical alignments across split checks, gratuity calculations, and live order summaries. Large titles and price declarations adopt aggressive negative letter-spacing to reinforce architectural density, while small badges and secondary metadata scale up character spacing for rapid scanning under variable handheld conditions.

## Layout & Spacing

The layout model is anchored on an 8pt base grid optimized for mobile viewports (PWA/Mobile Web). Standard viewport margins measure `1rem` (16px) on phone screens to prioritize horizontal touch area, scaling to `2rem` (32px) on tablet interfaces.

Content behaves as a continuous single-column flow constrained to a maximum content width of `480px` on mobile viewports, centered above that threshold for handheld balance. Dynamic viewports leverage strict safe-area insets (`env(safe-area-inset-bottom)`) to guarantee unclipped placement of fixed bottom controls over iOS home bars and Android system overlays. All interactable rows, card lists, and form elements adhere to an explicit minimum target height of `48px`.

## Elevation & Depth

Depth is established via diffused ambient occlusion rather than heavy drop shadows or stark borders. Surfaces rely on white card planes hovering against an off-white background canvas, reinforced by layered, low-opacity shadows tinted with deep charcoal.

- **Level 0 (Base Canvas)**: Flat `#F9FAFB`. No shadow.
- **Level 1 (Inline Cards, Dish Rows)**: `#FFFFFF` surface with a hairline border (`1px solid #E5E7EB`) and ambient shadow: `0 1px 3px rgba(17, 24, 39, 0.04), 0 1px 2px rgba(17, 24, 39, 0.02)`.
- **Level 2 (Active States, Floating Toggles)**: Elevated cards with `0 4px 12px -2px rgba(17, 24, 39, 0.06), 0 2px 6px -1px rgba(17, 24, 39, 0.03)`.
- **Level 3 (Modal Bottom Sheets, Sticky CTA Bars)**: High-altitude panels layered over a 40% frosted backdrop scrim (`rgba(17, 24, 39, 0.40)` with `backdrop-filter: blur(8px)`). Shadow: `0 -8px 24px -4px rgba(17, 24, 39, 0.08), 0 -2px 8px -1px rgba(17, 24, 39, 0.04)`.

## Shapes

The design system adopts a consistent 12px to 16px corner language, striking an intentional balance between approachable consumer software and crisp architectural structure.

- Standard cards, sheet containers, and modal dialogs utilize `16px` (`rounded-xl`).
- Interactive inputs, buttons, and individual menu item surfaces utilize `12px` (`rounded-lg`).
- Status indicators, category filter pills, and quantitative stepper bubbles utilize fully rounded ends (`9999px` / pill) to establish contrast against rectangular layout cards.

## Components

### Buttons
- **Primary CTA**: Fixed height of `52px` with a minimum touch zone of `48px`. Background is Primary Terracotta (`#E24A2D`), foreground is Pure White (`#FFFFFF`), `rounded-lg` (12px), bold body typography with subtle scale feedback on tap (`active:scale-[0.98]`).
- **Secondary CTA**: Background `#F3F4F6`, Deep Charcoal text (`#111827`), hover/press state `#E5E7EB`.
- **Destructive/Ghost CTA**: Text `#E24A2D` or `#6B7280` on transparent background; strictly text and icon with no structural border.

### Status Pills & Chips
- **Paid / Success**: `#ECFDF5` background, `#059669` text, `1px solid #A7F3D0`.
- **Preparing / In Progress**: `#FFFBEB` background, `#D97706` text, `1px solid #FDE68A`.
- **Inactive / Table Idle**: `#F3F4F6` background, `#6B7280` text, `1px solid #E5E7EB`.
- Form factor is always pill-shaped with `6px` vertical and `12px` horizontal padding, paired with a leading `6px` solid status circle.

### Menu Cards & Lists
- Surface is `#FFFFFF` with `1px solid #E5E7EB`, padding `16px`, and an internal horizontal layout.
- Media elements use fixed aspect ratio (`1:1`, 80x80px) with `8px` corner radius.
- Prices are declared using `headline-sm` with tabular typography and prominent Lira glyphs.

### Checkboxes & Radios
- Size: `22px × 22px` square (`6px` radius) for checkboxes; circular for radios.
- Unchecked: `1.5px solid #D1D5DB`, background transparent.
- Checked: `#E24A2D` background with an inset white check or inner dot. Minimum touch target padded out to `48px × 48px`.

### Input Fields
- `48px` default height, `12px` radius, background `#FFFFFF`, border `1px solid #E5E7EB`.
- Focused state transitions to `1px solid #E24A2D` with an ambient focus ring: `0 0 0 3px rgba(226, 74, 45, 0.12)`.
- Fixed Turkish prefix formatting for phone inputs (`+90`) and auto-formatted currency entry for manual tipping.

### Modal Bottom Sheets
- Anchored to bottom viewport with top corners rounded at `20px`.
- Includes a centered grab handle (`36px × 4px`, color `#D1D5DB`, `margin-top: 8px`).
- Internal content scroll independent of fixed bottom CTA.

### Sticky Bottom CTA Bar
- Docked permanently to viewport base with `backdrop-filter: blur(12px)` over `rgba(255, 255, 255, 0.92)`.
- Border-top `1px solid #E5E7EB`.
- Contains live subtotal/total metadata on the left with instant-action primary payment buttons on the right, fully respecting `env(safe-area-inset-bottom)`.