import { useEffect, type JSX, type ReactNode } from 'react'
import { IconClose } from './icons'

interface DrawerProps {
  open: boolean
  title: string
  subtitle: string
  onClose: () => void
  children: ReactNode
}

export function Drawer(props: DrawerProps): JSX.Element {
  const { open, title, subtitle, onClose, children } = props

  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div className={`drawer-layer${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="btn btn-icon" aria-label="Kapat" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  )
}
