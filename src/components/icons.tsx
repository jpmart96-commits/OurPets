import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, strokeWidth = 1.8, ...rest }: P) {
  return {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest
  }
}

export const IconHome = (p: P) => <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
export const IconPaw = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="10" r="2" /><circle cx="9.5" cy="5.5" r="2" /><circle cx="14.5" cy="5.5" r="2" /><circle cx="18.5" cy="10" r="2" />
    <path d="M12 12c-3 0-6 3.5-6 6 0 1.7 1.3 2.5 3 2.5 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.7 0 3-.8 3-2.5 0-2.5-3-6-6-6z" />
  </svg>
)
export const IconCoin = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M15.2 8.9a3.7 3.7 0 1 0 0 6.2M7.6 11h5.4M7.6 13.2h4.4" /></svg>
)
export const IconBox = (p: P) => <svg {...base(p)}><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>
export const IconCart = (p: P) => (
  <svg {...base(p)}><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.7 12.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6" /></svg>
)
export const IconBowl = (p: P) => <svg {...base(p)}><path d="M3 11h18a9 9 0 0 1-18 0z" /><path d="M8 7.5c0-1.5 1-2 1-3.5M12 7.5c0-1.5 1-2 1-3.5M16 7.5c0-1.5 1-2 1-3.5" /></svg>
export const IconPill = (p: P) => <svg {...base(p)}><rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" /><path d="M8.5 8.5l7 7" /></svg>
export const IconCalendar = (p: P) => <svg {...base(p)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
export const IconCheck = (p: P) => <svg {...base({ strokeWidth: 2.6, ...p })}><path d="M5 12.5 10 17l9-10" /></svg>
export const IconPlus = (p: P) => <svg {...base({ strokeWidth: 2.2, ...p })}><path d="M12 5v14M5 12h14" /></svg>
export const IconBack = (p: P) => <svg {...base({ strokeWidth: 2, ...p })}><path d="M15 5l-7 7 7 7" /></svg>
export const IconChevron = (p: P) => <svg {...base({ strokeWidth: 2, ...p })}><path d="M9 5l7 7-7 7" /></svg>
export const IconExternal = (p: P) => <svg {...base({ strokeWidth: 2.2, ...p })}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
export const IconDoc = (p: P) => <svg {...base(p)}><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></svg>
export const IconTrash = (p: P) => <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
export const IconCamera = (p: P) => <svg {...base(p)}><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
export const IconX = (p: P) => <svg {...base({ strokeWidth: 2.6, ...p })}><path d="M6 6l12 12M18 6 6 18" /></svg>
export const IconPhone = (p: P) => <svg {...base(p)}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
export const IconAlert = (p: P) => <svg {...base(p)}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17.5v.01" /></svg>
export const IconShield = (p: P) => <svg {...base(p)}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
