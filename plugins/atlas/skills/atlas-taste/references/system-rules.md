# system-rules: one strict system

A UI looks consistent when each kind of decision is made once and reused. These rules name the decisions. They carry no values: every value comes from the project's tokens in `docs/standards/design-system.md`. If a needed value is missing from the tokens, ask the user, add it to the token file, then use it.

| Decision | Rule |
|---|---|
| Spacing | One scale. Padding, margin and gap use scale tokens only. No one-off pixel or rem values. |
| Type | One scale and one set of families. Sizes, weights and line heights are tokens. A new size is a token first. |
| Radius | One radius family. Each component class (control, card, pill, modal) names its radius token; nothing picks a number. |
| Buttons | One button family: the same variants, sizes and states everywhere. A new variant is added to the family, not built beside it. |
| Cards and surfaces | One recipe: background, border or shadow, radius and padding from tokens. Nested surfaces step through the same recipe. |
| Hairlines | One border width and one border color token. Dividers and outlines reuse them. |
| Icons | One library (`icon_library`), one size set, one stroke or fill style. A domain object keeps the same icon on every surface. |
| Links | One link style for text links, including hover and visited states. |
| Motion | One set of durations and one easing set, as tokens. Respect reduced-motion preferences. |
| Color | Roles, not hues: surface, text, border, accent, danger and so on, as the project defines them. Components reference roles. |
| Focus | Every interactive element shows a visible focus ring from a token. Never remove an outline without a replacement. |
| Contrast | Text and interactive boundaries meet WCAG AA against their surface. Check with the project's own tooling or ask the user to confirm. |
| Keyboard | Everything clickable is reachable and operable by keyboard; row-click targets also expose a focusable control. |
| Targets | Touch targets meet the platform minimum. |

## How to apply

1. Before writing a style value, look it up in the token file. Found: use the token. Missing: ask.
2. Before writing markup that looks like something already in the app, search for it (see `components.md`) and reuse the shared component.
3. After the change, run `taste_check.py`. FAIL means a raw value or a wrong icon import; WARN means a spacing or radius literal off the scale. Fix by switching to the token, not by editing `allow_raw_values_in`.
4. Platform code (SwiftUI, Android, Flutter) follows the same table with the platform's own theme objects as the tokens. The static check covers CSS and JSON tokens only; review the rest by reading.
