import * as React from "react"

/**
 * The platform mark (stumps, bails and ball on the pitch-green tile), inline
 * so it stays crisp at any size and needs no request. Same artwork as
 * public/icons/logo.svg, which the favicons are generated from; keep the two
 * in sync. Hook-free so it renders inside the home page's plain-function tests.
 *
 * `idPrefix` keeps gradient ids unique when the mark appears twice on a page.
 */
export function BrandMark({ className, idPrefix = "brand-mark" }: { className?: string; idPrefix?: string }) {
  const tile = `${idPrefix}-tile`
  const ball = `${idPrefix}-ball`
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22c55e" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
        <linearGradient id={ball} x1="38" y1="35" x2="56" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f87171" />
          <stop offset="1" stopColor="#b91c1c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${tile})`} />
      <rect x="13.5" y="14.5" width="13" height="3.5" rx="1.75" fill="#fff" />
      <rect x="28" y="14.5" width="13" height="3.5" rx="1.75" fill="#fff" />
      <rect x="14.5" y="20" width="5.5" height="31" rx="2.75" fill="#fff" />
      <rect x="24.5" y="20" width="5.5" height="31" rx="2.75" fill="#fff" />
      <rect x="34.5" y="20" width="5.5" height="31" rx="2.75" fill="#fff" />
      <circle cx="46.5" cy="43.5" r="11.5" fill="#047857" />
      <circle cx="46.5" cy="43.5" r="9.5" fill={`url(#${ball})`} />
      <path d="M40.2 37.2a9.5 9.5 0 0 1 12.6 12.6" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M38.9 40.8a9.5 9.5 0 0 1 10.3 10.3"
        stroke="#fff"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeDasharray="1.4 1.6"
        opacity=".85"
      />
    </svg>
  )
}
