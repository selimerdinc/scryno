import { useRef, type JSX, type PointerEvent } from 'react'
import type { DevicePlatform } from '../../../shared/types'

interface PhoneModelProps {
  platform: DevicePlatform
  live: boolean
  dimmed: boolean
  caption: string
  preview: string | null
  locked: boolean
}

const MAX_TILT = 14

export function PhoneModel(props: PhoneModelProps): JSX.Element {
  const { platform, live, dimmed, caption, preview, locked } = props
  const stageRef = useRef<HTMLDivElement>(null)

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    const rect = stage.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    stage.style.setProperty('--ry', `${x * MAX_TILT * 2}deg`)
    stage.style.setProperty('--rx', `${-y * MAX_TILT}deg`)
    stage.style.setProperty('--gx', `${(x + 0.5) * 100}%`)
  }

  const onPointerLeave = (): void => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    stage.style.removeProperty('--ry')
    stage.style.removeProperty('--rx')
    stage.style.removeProperty('--gx')
  }

  const classes = [
    'phone',
    `phone--${platform}`,
    live ? 'is-live' : '',
    dimmed ? 'is-dimmed' : '',
    locked && !preview ? 'is-locked' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={stageRef}
      className="phone-stage"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className={classes}>
        <div className="phone-back" />
        <span className="phone-key phone-key--a" />
        <span className="phone-key phone-key--b" />
        <span className="phone-key phone-key--c" />
        <div className="phone-screen">
          <div className="phone-wallpaper" />
          {preview ? <img className="phone-liveview" src={preview} alt="" draggable={false} /> : null}
          {platform === 'ios' ? <div className="phone-island" /> : <div className="phone-punch" />}
          {locked && !preview ? (
            <div className="phone-lock">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.4" fill="currentColor" />
                <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.8" />
              </svg>
              <span>Kilitli</span>
              <small>Açınca görünür</small>
            </div>
          ) : null}
          {preview || locked ? null : <div className="phone-caption">{caption}</div>}
          {live && !preview ? <div className="phone-scan" /> : null}
          <div className="phone-glare" />
        </div>
      </div>
      <div className="phone-floor" />
    </div>
  )
}
