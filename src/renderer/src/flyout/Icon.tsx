import type { JSX } from 'react'

/**
 * A Material Symbols Outlined glyph. `fill` selects the filled variant (FILL 1)
 * used for the app mark, breadcrumb folder, pause/play, and status timer. Size is
 * set per-use since the prototype uses many distinct icon sizes.
 */
export function Icon({
  name,
  fill = false,
  className
}: {
  name: string
  fill?: boolean
  className?: string
}): JSX.Element {
  const cls = ['material-symbols-outlined', fill ? 'ms-fill' : '', className]
    .filter(Boolean)
    .join(' ')
  // The glyph is a ligature (its name IS its text content), so hide it from the
  // accessibility tree — otherwise icon+text buttons announce "pause Pause" etc.
  // (buttons carry their own aria-label/visible text). translate="no" stops
  // browser translation mangling the ligature.
  return (
    <span className={cls} aria-hidden="true" translate="no">
      {name}
    </span>
  )
}
