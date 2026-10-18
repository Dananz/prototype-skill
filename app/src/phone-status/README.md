# iPhone status bar

`ios.svg` contains 9:41 and the cellular, Wi-Fi and full-battery artwork from
Apple's official **iOS 27 UI Kit**, `Status Bars/iPhone 17 Pro/Light Background`.
It has a transparent 402 × 62 viewBox. The Dynamic Island is omitted because the
prototype shell draws it separately. The same mask supports light and dark screens.

Use this asset in the prototype's shared `parts` file instead of text glyphs or
generic icon-library approximations. Keep it full-width and reserve its 62-point
height; place it outside any content padding. Set its color from the screen,
independently of the shell theme.

```tsx
import status from '../../phone-status/ios.svg'

export function StatusBar() {
  const mask = `url(${status}) center / 100% 100% no-repeat`
  return <div
    role="img"
    aria-label="9:41, full cellular signal, Wi-Fi connected, full battery"
    style={{ height: 62, flexShrink: 0, background: 'currentColor', mask, WebkitMask: mask }}
  />
}
```

The SVG mask works in Vue and plain HTML too. It outlines the time so its SF Pro
appearance does not depend on fonts installed on the viewer's machine.

## Source

- [Apple Design Resources](https://developer.apple.com/design/resources/)
- [Official Sketch kit, published by Apple](https://www.sketch.com/s/04c24d8b-38fb-4afb-8836-36617e022f02)
- Downloaded October 18, 2026, kit version 24 (September 22, 2026).
- Source symbol: `FEA1B9B8-FA23-4BD0-A65E-C98F9DE1A906`.
- Wi-Fi and battery: original Bézier paths and layer positions converted from
  Sketch's normalized coordinates to SVG. Cellular: original rounded bar bounds.
- Time: the kit's `SFPro-Semibold`, 17.67 points, converted to outlines with CoreText.
- Kit SHA-256: `465512cb7d9fa591844c32cda133c52ea2e69a143d7cfbb958d5b3ef180b948c`.

The Apple artwork remains copyright Apple Inc. and is subject to Apple's Design
Resources terms, rather than this repository's MIT license.
