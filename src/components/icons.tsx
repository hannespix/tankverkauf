interface P { className?: string }
const base = 'h-[1.15em] w-[1.15em] shrink-0'
const svg = (d: React.ReactNode, extra?: string) =>
  function Icon({ className = '' }: P) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={`${base} ${extra ?? ''} ${className}`} aria-hidden="true">
        {d}
      </svg>
    )
  }

export const IconGauge = svg(<><path d="M12 21a9 9 0 1 0-9-9" /><path d="M3 12h3M12 3v3M18.4 5.6l-2.1 2.1M21 12h-3" /><path d="m12 12 4.5-2.5" /><circle cx="12" cy="12" r="1.5" /></>)
export const IconTank = svg(<><rect x="5" y="3" width="14" height="18" rx="4" /><path d="M5 9h14M5 15h14" /><path d="M9 21v1M15 21v1" /></>)
export const IconUsers = svg(<><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.9M18 20a6.4 6.4 0 0 0-2.2-4.8" /></>)
export const IconHandshake = svg(<><path d="m11 17 2 2a1.4 1.4 0 0 0 2-2" /><path d="m13 15 2.5 2.5a1.4 1.4 0 0 0 2-2L13 11" /><path d="M3 10.5 7 7l4 3-2.5 2.5a1.8 1.8 0 0 0 2.5 2.5L14 12" /><path d="M13 7h4l4 3.5" /><path d="m3 10.5 3 5M21 10.5l-3 5" /></>)
export const IconMegaphone = svg(<><path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1Z" /><path d="M19 9a3.5 3.5 0 0 1 0 6" /><path d="M7 14v5" /></>)
// A cog needs teeth — without them it is indistinguishable from IconSun,
// which sits right next to it in the mobile header.
export const IconCog = svg(<><path d="M10.17 2.58L13.83 2.58L14.46 5.23L15.04 5.47L17.37 4.04L19.96 6.63L18.53 8.96L18.77 9.54L21.42 10.17L21.42 13.83L18.77 14.46L18.53 15.04L19.96 17.37L17.37 19.96L15.04 18.53L14.46 18.77L13.83 21.42L10.17 21.42L9.54 18.77L8.96 18.53L6.63 19.96L4.04 17.37L5.47 15.04L5.23 14.46L2.58 13.83L2.58 10.17L5.23 9.54L5.47 8.96L4.04 6.63L6.63 4.04L8.96 5.47L9.54 5.23Z" /><circle cx="12" cy="12" r="3.1" /></>)
export const IconSearch = svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>)
export const IconClose = svg(<><path d="m6 6 12 12M18 6 6 18" /></>)
export const IconCheck = svg(<><path d="m4 12.5 5 5L20 6.5" /></>)
export const IconCopy = svg(<><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" /></>)
export const IconPlus = svg(<><path d="M12 5v14M5 12h14" /></>)
export const IconCamera = svg(<><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.9a1 1 0 0 0 .83-.45l.94-1.4A1 1 0 0 1 10 3.7h4a1 1 0 0 1 .83.45l.94 1.4a1 1 0 0 0 .83.45h1.9A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z" /><circle cx="12" cy="13" r="3.5" /></>)
export const IconDownload = svg(<><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M4 20h16" /></>)
export const IconUpload = svg(<><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" /><path d="M4 20h16" /></>)
export const IconCloud = svg(<><path d="M7 18a4.2 4.2 0 0 1-.5-8.4A5.5 5.5 0 0 1 17.3 10 3.9 3.9 0 0 1 17 18Z" /></>)
export const IconLock = svg(<><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>)
export const IconSun = svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M22 12h-2M4 12H2M19 5l-1.5 1.5M6.5 17.5 5 19M19 19l-1.5-1.5M6.5 6.5 5 5" /></>)
export const IconMoon = svg(<><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></>)
export const IconWarn = svg(<><path d="M12 3.5 2.7 19.5a1 1 0 0 0 .87 1.5h16.86a1 1 0 0 0 .87-1.5Z" /><path d="M12 9v5M12 17.2v.1" /></>)
export const IconTrash = svg(<><path d="M4 7h16M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M10 11v6M14 11v6" /></>)
export const IconLink = svg(<><path d="M10 13a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 4.4l-1.7 1.7" /><path d="M14 11a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.6l1.7-1.7" /></>)
export const IconRefresh = svg(<><path d="M20 12a8 8 0 1 1-2.5-5.8" /><path d="M20 3.5V9h-5.5" /></>)
export const IconChevron = svg(<><path d="m9 6 6 6-6 6" /></>)
export const IconSpark = svg(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M12 8.5 13.6 12 12 15.5 10.4 12Z" /></>)
export const IconClock = svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 2" /></>)
export const IconFilter = svg(<><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></>)
