import type { JSX } from 'react'

export interface IosOptions {
  enlargeOnStart: boolean
  recordOnStart: boolean
  restoreOnClose: boolean
}

interface IosControlsProps {
  busy: boolean
  ready: boolean
  options: IosOptions
  onChange: (options: IosOptions) => void
  onEnlarge: () => void
  onRestore: () => void
}

function SettingSwitch(props: {
  title: string
  detail: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  const { title, detail, checked, disabled, onChange } = props
  return (
    <label className={`setting${disabled ? ' is-disabled' : ''}`}>
      <span className="setting-copy">
        <span className="setting-name">{title}</span>
        <span className="setting-detail">{detail}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  )
}

export function IosControls(props: IosControlsProps): JSX.Element {
  const { busy, ready, options, onChange, onEnlarge, onRestore } = props

  return (
    <div className="setting-list">
      <SettingSwitch
        title="Açılışta büyüt"
        detail="Yansıt’a basınca iPhone penceresi Apple’ın izin verdiği en büyük boyuta gelir."
        checked={options.enlargeOnStart}
        disabled={busy}
        onChange={(enlargeOnStart) => onChange({ ...options, enlargeOnStart })}
      />
      <SettingSwitch
        title="Otomatik kayıt"
        detail="Yansıma başlar başlamaz video, İndirilenler içindeki Scryno klasörüne kaydedilir."
        checked={options.recordOnStart}
        disabled={busy}
        onChange={(recordOnStart) => onChange({ ...options, recordOnStart })}
      />
      <SettingSwitch
        title="Kopunca geri getir"
        detail="Yansıma açıkken iPhone penceresi kapanırsa Scryno pencereyi yeniden açar."
        checked={options.restoreOnClose}
        disabled={busy}
        onChange={(restoreOnClose) => onChange({ ...options, restoreOnClose })}
      />
      <div className="setting">
        <span className="setting-copy">
          <span className="setting-name">Büyüt</span>
          <span className="setting-detail">
            iPhone Mirroring penceresini bir kademe büyütür. Apple daha fazla büyütmeye izin vermez.
          </span>
        </span>
        <button type="button" className="btn" disabled={busy || !ready} onClick={onEnlarge}>
          Büyüt
        </button>
      </div>
      <div className="setting">
        <span className="setting-copy">
          <span className="setting-name">Pencereyi geri getir</span>
          <span className="setting-detail">
            iPhone Mirroring kapandıysa veya kontrol çubuğu kaybolduysa pencereyi ve çubuğu yeniden açar.
          </span>
        </span>
        <button type="button" className="btn" disabled={busy || !ready} onClick={onRestore}>
          Getir
        </button>
      </div>
    </div>
  )
}
