import type { JSX, ReactNode } from 'react'

interface IconProps {
  size?: number
}

function Svg({ size = 18, children }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconRefresh(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </Svg>
  )
}

export function IconFolder(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l1.8 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-10Z" />
    </Svg>
  )
}

export function IconCamera(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8.5 7 10 5h4l1.5 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5Z" />
      <circle cx="12" cy="13" r="3" />
    </Svg>
  )
}

export function IconWifi(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2.5 9a14 14 0 0 1 19 0" />
      <path d="M5.5 12.5a9.5 9.5 0 0 1 13 0" />
      <path d="M8.7 16a5 5 0 0 1 6.6 0" />
      <circle cx="12" cy="19.2" r="0.9" fill="currentColor" />
    </Svg>
  )
}

export function IconPlay(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconStop(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconLink(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Svg>
  )
}

export function IconClose(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

export function IconSliders(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Svg>
  )
}

export function IconSparkle(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 3.5 13.8 9 19.5 11l-5.7 2L12 18.5 10.2 13 4.5 11l5.7-2L12 3.5Z" />
    </Svg>
  )
}

export function IconAndroid(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6.5 10.5h11v6.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5v-6.5Z" />
      <path d="M6.5 10.5a5.5 5.5 0 0 1 11 0" />
      <path d="M8.2 5.2 9.3 7M15.8 5.2 14.7 7" />
      <circle cx="9.8" cy="8.4" r="0.6" fill="currentColor" />
      <circle cx="14.2" cy="8.4" r="0.6" fill="currentColor" />
    </Svg>
  )
}

export function IconApple(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M15.6 12.6c0-2 1.6-2.9 1.7-3a3.7 3.7 0 0 0-2.9-1.6c-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7a3.9 3.9 0 0 0-3.3 2c-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.5 2s1.4-.6 2.6-.6 1.5.6 2.6.6 1.7-1 2.4-2a8 8 0 0 0 1.1-2.2 3.4 3.4 0 0 1-2.1-3.2Z" />
      <path d="M13.7 6.2a3.4 3.4 0 0 0 .8-2.5 3.5 3.5 0 0 0-2.3 1.2 3.2 3.2 0 0 0-.8 2.4 2.9 2.9 0 0 0 2.3-1.1Z" />
    </Svg>
  )
}

export function IconShield(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 3.5 19 6v5.5c0 4.3-3 7.7-7 9-4-1.3-7-4.7-7-9V6l7-2.5Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  )
}

export function IconChevron(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  )
}

export function IconChevronDown(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function IconDeviceScreen(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <path d="M11 18h2" />
    </Svg>
  )
}

export function IconSearch(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  )
}

export function IconCheck(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="m5 13 4 4L19 7" strokeWidth="2.2" />
    </Svg>
  )
}

export function IconVideo({ size = 18, live = false }: IconProps & { live?: boolean }): JSX.Element {
  return (
    <Svg size={size}>
      <rect x="2" y="5" width="13" height="14" rx="2" fill={live ? 'currentColor' : 'none'} />
      <polygon points="17 9 22 6 22 18 17 15 17 9" fill={live ? 'currentColor' : 'none'} />
    </Svg>
  )
}

