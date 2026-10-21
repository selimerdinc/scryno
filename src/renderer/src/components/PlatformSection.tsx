import type { JSX, ReactNode } from 'react'
import type { DevicePlatform } from '../../../shared/types'
import { IconAndroid, IconApple } from './icons'

interface PlatformSectionProps {
  platform: DevicePlatform
  title: string
  tagline: string
  count: number
  liveCount: number
  actions?: ReactNode
  footer?: ReactNode
  empty: ReactNode
  children: ReactNode
}

export function PlatformSection(props: PlatformSectionProps): JSX.Element {
  const { platform, title, tagline, count, liveCount, actions, footer, empty, children } = props

  return (
    <section className={`platform platform--${platform}`}>
      <header className="platform-head">
        <div className="platform-mark">
          {platform === 'ios' ? <IconApple size={20} /> : <IconAndroid size={20} />}
        </div>
        <div className="platform-titles">
          <h2>
            {title}
            <span className="platform-count">{count}</span>
            {liveCount > 0 ? <span className="platform-live">{liveCount} canlı</span> : null}
          </h2>
          <p>{tagline}</p>
        </div>
        {actions ? <div className="platform-actions">{actions}</div> : null}
      </header>

      {count === 0 ? <div className="platform-empty">{empty}</div> : <div className="card-grid">{children}</div>}

      {footer ? <div className="platform-footer">{footer}</div> : null}
    </section>
  )
}
