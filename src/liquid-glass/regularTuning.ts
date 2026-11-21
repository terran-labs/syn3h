/** The display-space transfer is quadratic for buttons and linear for panels.
 * Fold tint and brightness into its coefficients when a setting changes. */
export function regularTransfer(dark: boolean, tint: number, offset: number) {
  return {
    quadratic: (dark ? -.39 : -.034) * tint,
    slope: 1 + ((dark ? .99 : .506) - 1) * tint,
    lift: (dark ? 32 : 133) / 255 * tint + offset,
    panelSlope: 1 + ((dark ? 90 : 118) / 255 - 1) * tint,
    panelLift: (dark ? 32 : 136) / 255 * tint + offset,
  }
}
