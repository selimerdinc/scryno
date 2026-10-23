import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  AndroidAppInfo,
  MirrorOptions,
  MirrorOrientation,
  MirrorSource
} from '../../../shared/types'
import {
  IconCheck,
  IconChevronDown,
  IconDeviceScreen,
  IconSearch,
  IconSliders
} from './icons'

interface QualityControlProps {
  options: MirrorOptions
  busy: boolean
  deviceId: string | null
  onChange: (options: MirrorOptions) => void
}

interface Preset {
  id: string
  label: string
  hint: string
  maxSize: number
  bitRate: number
  maxFps: number
}

const PRESETS: Preset[] = [
  {
    id: 'smooth',
    label: 'Akıcı',
    hint: '1024px · 6 Mbps',
    maxSize: 1024,
    bitRate: 6_000_000,
    maxFps: 60
  },
  {
    id: 'balanced',
    label: 'Dengeli',
    hint: '1280px · 8 Mbps',
    maxSize: 1280,
    bitRate: 8_000_000,
    maxFps: 60
  },
  {
    id: 'sharp',
    label: 'Keskin',
    hint: '1920px · 16 Mbps',
    maxSize: 1920,
    bitRate: 16_000_000,
    maxFps: 60
  }
]

const SOURCES: { id: MirrorSource; label: string; detail: string }[] = [
  {
    id: 'display',
    label: 'Telefon ekranı',
    detail: 'Telefonun o anki ekranı Mac’te açılır. Dokunma, klavye ve dosya bırakma çalışır.'
  },
  {
    id: 'camera',
    label: 'Kamera',
    detail:
      'Ekran yerine telefonun kamerası açılır. Android 12 ve üzeri. Ses açıksa mikrofon da Mac’e gelir.'
  },
  {
    id: 'virtual',
    label: 'Sanal ekran',
    detail:
      'Telefonda ayrı bir ekran açılır. Telefonun kendi ekranı serbest kalır, uygulamayı Mac’te kullanırsın.'
  }
]

interface SettingRowProps {
  title: string
  detail: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

function SettingRow(props: SettingRowProps): JSX.Element {
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

export function QualityControl(props: QualityControlProps): JSX.Element {
  const { options, busy, deviceId, onChange } = props
  const [advanced, setAdvanced] = useState(false)
  const [apps, setApps] = useState<AndroidAppInfo[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [appsError, setAppsError] = useState('')
  const [appQuery, setAppQuery] = useState('')
  const [appPickerOpen, setAppPickerOpen] = useState(false)
  const appPickerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const source = options.source ?? 'display'
  const audioOn = options.audio !== false
  const sourceInfo = SOURCES.find((item) => item.id === source) ?? SOURCES[0]
  const selectedApp = apps.find((app) => app.packageName === options.startApp)
  const filteredApps = useMemo(() => {
    const query = appQuery.trim().toLocaleLowerCase('tr')
    if (!query) {
      return apps.slice(0, 80)
    }
    return apps
      .filter(
        (app) =>
          app.name.toLocaleLowerCase('tr').includes(query) ||
          app.packageName.toLocaleLowerCase('tr').includes(query)
      )
      .slice(0, 80)
  }, [appQuery, apps])
  const active = PRESETS.find(
    (preset) =>
      preset.maxSize === options.maxSize &&
      preset.bitRate === options.bitRate &&
      preset.maxFps === options.maxFps
  )

  useEffect(() => {
    if (!appPickerOpen) {
      return
    }
    const handleClickOutside = (e: MouseEvent): void => {
      if (appPickerRef.current && !appPickerRef.current.contains(e.target as Node)) {
        setAppPickerOpen(false)
        setAppQuery('')
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setAppPickerOpen(false)
        setAppQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 40)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
      window.clearTimeout(timer)
    }
  }, [appPickerOpen])

  useEffect(() => {
    if (!deviceId || source === 'camera') {
      setApps([])
      setAppsError('')
      return
    }

    let cancelled = false
    let retryTimer: number | null = null
    setAppsLoading(true)
    setAppsError('')
    const loadApps = async (attempt: number): Promise<void> => {
      const result = await window.scryno.listAndroidApps(deviceId)
      if (cancelled) {
        return
      }
      if (result.ok) {
        setApps(result.apps)
        setAppsLoading(false)
        return
      }
      if (attempt < 2) {
        retryTimer = window.setTimeout(() => void loadApps(attempt + 1), 800)
        return
      }
      setAppsError(result.message)
      setAppsLoading(false)
    }
    void loadApps(0)
    return () => {
      cancelled = true
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [deviceId, source])

  return (
    <div className="quality">
      <p className="quality-note">
        Yansıt’a bastığında uygulanır. Açık olan yansımayı değiştirmez.
      </p>

      <div className="setting-block">
        <span className="setting-name">Ne yansıtılsın</span>
        <div className="segmented" role="radiogroup" aria-label="Yansıma kaynağı">
          {SOURCES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={source === item.id}
              className={`segment${source === item.id ? ' active' : ''}`}
              disabled={busy}
              onClick={() => onChange({ ...options, source: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="setting-detail">{sourceInfo.detail}</p>
      </div>

      {source === 'camera' ? (
        <div className="setting-block">
          <span className="setting-name">Hangi kamera</span>
          <div className="segmented" role="radiogroup" aria-label="Kamera yönü">
            <button
              type="button"
              role="radio"
              aria-checked={(options.cameraFacing ?? 'back') === 'back'}
              className={`segment${(options.cameraFacing ?? 'back') === 'back' ? ' active' : ''}`}
              disabled={busy}
              onClick={() => onChange({ ...options, cameraFacing: 'back' })}
            >
              Arka
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={options.cameraFacing === 'front'}
              className={`segment${options.cameraFacing === 'front' ? ' active' : ''}`}
              disabled={busy}
              onClick={() => onChange({ ...options, cameraFacing: 'front' })}
            >
              Ön
            </button>
          </div>
          <p className="setting-detail">Arka kamera geniş açılıdır. Ön kamera yüzünü gösterir.</p>
        </div>
      ) : null}

      {source !== 'camera' ? (
        <div className="setting-block">
          <div className="field app-picker" ref={appPickerRef}>
            <div className="app-picker-header">
              <span className="setting-name">Açılacak uygulama</span>
              {options.startApp ? (
                <button
                  type="button"
                  className="app-picker-reset-btn"
                  disabled={busy}
                  onClick={() => {
                    onChange({ ...options, startApp: '' })
                    setAppQuery('')
                  }}
                  title="Varsayılan ekrana dön"
                >
                  Sıfırla
                </button>
              ) : null}
            </div>

            {/* Premium Selector Trigger (Never looks like a blank input) */}
            <button
              type="button"
              className={`app-picker-trigger ${appPickerOpen ? 'is-open' : ''} ${options.startApp ? 'has-value' : ''}`}
              disabled={busy || appsLoading || !deviceId}
              onClick={() => setAppPickerOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={appPickerOpen}
            >
              <div className="app-picker-trigger-left">
                <div className={`app-picker-badge ${options.startApp ? 'is-app' : 'is-default'}`}>
                  {options.startApp ? (
                    (selectedApp?.name || options.startApp).charAt(0).toUpperCase()
                  ) : (
                    <IconDeviceScreen size={15} />
                  )}
                </div>
                <div className="app-picker-text-group">
                  <div className="app-picker-main-text">
                    {appsLoading
                      ? 'Uygulamalar okunuyor…'
                      : options.startApp
                        ? (selectedApp?.name ?? options.startApp)
                        : 'Varsayılan Ekran'}
                  </div>
                  <div className="app-picker-sub-text">
                    {options.startApp
                      ? (selectedApp?.packageName ?? 'Seçili uygulama')
                      : 'Uygulama açılmaz, mevcut ekran gelir'}
                  </div>
                </div>
              </div>

              <div className="app-picker-trigger-right">
                {options.startApp ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="app-picker-inline-clear"
                    title="Uygulama seçimini kaldır"
                    aria-label="Uygulama seçimini kaldır"
                    onClick={(e) => {
                      e.stopPropagation()
                      onChange({ ...options, startApp: '' })
                      setAppQuery('')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        onChange({ ...options, startApp: '' })
                        setAppQuery('')
                      }
                    }}
                  >
                    ×
                  </span>
                ) : null}
                <span className={`app-picker-chevron ${appPickerOpen ? 'is-flipped' : ''}`}>
                  <IconChevronDown size={14} />
                </span>
              </div>
            </button>

            {/* Popover Dropdown */}
            {appPickerOpen && !appsLoading ? (
              <div className="app-picker-popover" role="listbox">
                <div className="app-picker-search-wrap">
                  <span className="app-picker-search-icon">
                    <IconSearch size={14} />
                  </span>
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="app-picker-search-input"
                    placeholder="Uygulama ara (örn: WhatsApp, Kamera)..."
                    value={appQuery}
                    onChange={(e) => setAppQuery(e.target.value)}
                  />
                  {appQuery ? (
                    <button
                      type="button"
                      className="app-picker-search-clear"
                      onClick={() => setAppQuery('')}
                      aria-label="Aramayı temizle"
                    >
                      ×
                    </button>
                  ) : null}
                </div>

                <div className="app-picker-list">
                  {/* Default / No App Option */}
                  <button
                    type="button"
                    role="option"
                    aria-selected={!options.startApp}
                    className={`app-picker-row ${!options.startApp ? 'is-selected' : ''}`}
                    onClick={() => {
                      setAppPickerOpen(false)
                      setAppQuery('')
                      onChange({ ...options, startApp: '' })
                    }}
                  >
                    <div className="app-picker-row-left">
                      <div className="app-picker-badge is-default">
                        <IconDeviceScreen size={15} />
                      </div>
                      <div className="app-picker-text-group">
                        <div className="app-picker-main-text">Varsayılan Ekran</div>
                        <div className="app-picker-sub-text">Uygulama açılmaz, mevcut ekran veya ana ekran gelir</div>
                      </div>
                    </div>
                    {!options.startApp ? (
                      <span className="app-picker-check">
                        <IconCheck size={14} />
                      </span>
                    ) : null}
                  </button>

                  <div className="app-picker-section-divider">
                    <span>Yüklü Uygulamalar ({filteredApps.length})</span>
                  </div>

                  {filteredApps.map((app) => {
                    const isSelected = options.startApp === app.packageName
                    return (
                      <button
                        key={app.packageName}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`app-picker-row ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => {
                          setAppPickerOpen(false)
                          setAppQuery('')
                          onChange({ ...options, startApp: app.packageName })
                        }}
                      >
                        <div className="app-picker-row-left">
                          <div className="app-picker-badge is-app">
                            {app.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="app-picker-text-group">
                            <div className="app-picker-main-text">{app.name}</div>
                            <div className="app-picker-sub-text">{app.packageName}</div>
                          </div>
                        </div>
                        {isSelected ? (
                          <span className="app-picker-check">
                            <IconCheck size={14} />
                          </span>
                        ) : null}
                      </button>
                    )
                  })}

                  {filteredApps.length === 0 ? (
                    <div className="app-picker-empty">
                      <span>"{appQuery}" ile eşleşen uygulama bulunamadı</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <p className="setting-detail">
            {appsError
              ? appsError
              : source === 'virtual'
                ? 'Seçtiğin uygulama yeni sanal ekranda açılır. Seçmezsen ana ekran gelir.'
                : 'Yansıma açılırken seçtiğin uygulama telefonda otomatik açılır.'}
          </p>
          {source === 'virtual' ? (
            <SettingRow
              title="Kapanınca telefona taşı"
              detail="Sanal ekranı kapatınca uygulama kapanmaz, telefonun kendi ekranına geçer."
              checked={Boolean(options.keepVirtualApp)}
              disabled={busy}
              onChange={(keepVirtualApp) => onChange({ ...options, keepVirtualApp })}
            />
          ) : null}
        </div>
      ) : null}

      {source !== 'camera' ? (
        <div className="setting-block">
          <span className="setting-name">Yön kilidi</span>
          <div className="segmented" role="radiogroup" aria-label="Yön kilidi">
            {(
              [
                ['auto', 'Otomatik'],
                ['initial', 'Başlangıç'],
                ['portrait', 'Dikey'],
                ['landscape', 'Yatay']
              ] as [MirrorOrientation, string][]
            ).map(([orientation, label]) => (
              <button
                key={orientation}
                type="button"
                role="radio"
                aria-checked={(options.orientation ?? 'auto') === orientation}
                className={`segment${(options.orientation ?? 'auto') === orientation ? ' active' : ''}`}
                disabled={busy}
                onClick={() => onChange({ ...options, orientation })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="setting-detail">
            Otomatik telefonla birlikte döner. Başlangıç ilk açıldığı yönü korur. Dikey ve Yatay
            yönü sabitler.
          </p>
        </div>
      ) : null}

      <div className="setting-block">
        <div className="quality-row">
          <div className="segmented" role="radiogroup" aria-label="Görüntü kalitesi">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active?.id === preset.id}
                className={`segment${active?.id === preset.id ? ' active' : ''}`}
                title={preset.hint}
                disabled={busy}
                onClick={() =>
                  onChange({
                    ...options,
                    maxSize: preset.maxSize,
                    bitRate: preset.bitRate,
                    maxFps: preset.maxFps
                  })
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`btn btn-icon${advanced ? ' active' : ''}`}
            title="Çözünürlük, bitrate ve FPS"
            aria-label="Gelişmiş görüntü ayarları"
            aria-expanded={advanced}
            onClick={() => setAdvanced((value) => !value)}
          >
            <IconSliders size={17} />
          </button>
        </div>
        <p className="setting-detail">
          Akıcı daha az gecikir. Dengeli günlük kullanımdır. Keskin daha nettir, daha fazla ağ
          ister.
        </p>
      </div>

      {advanced ? (
        <div className="quality-advanced">
          <div className="field">
            <label htmlFor="maxSize">Maks. çözünürlük (px)</label>
            <input
              id="maxSize"
              type="number"
              min={480}
              max={2560}
              step={160}
              value={options.maxSize ?? 1280}
              onChange={(event) =>
                onChange({
                  ...options,
                  maxSize: Number(event.target.value) || 1280
                })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="bitRate">Bitrate (Mbps)</label>
            <input
              id="bitRate"
              type="number"
              min={1}
              max={32}
              step={1}
              value={Math.round((options.bitRate ?? 8_000_000) / 1_000_000)}
              onChange={(event) =>
                onChange({
                  ...options,
                  bitRate: (Number(event.target.value) || 8) * 1_000_000
                })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="maxFps">Maks. FPS</label>
            <input
              id="maxFps"
              type="number"
              min={15}
              max={120}
              step={5}
              value={options.maxFps ?? 60}
              onChange={(event) =>
                onChange({
                  ...options,
                  maxFps: Number(event.target.value) || 60
                })
              }
            />
          </div>
        </div>
      ) : null}

      <div className="setting-list">
        <SettingRow
          title="Ses"
          detail={
            source === 'camera'
              ? 'Kamerayla birlikte telefonun mikrofonu da Mac’e gelir. Android 11 ve üzeri.'
              : 'Telefonun sesi Mac’ten çalar, telefonun hoparlörü susar. Android 11 ve üzeri.'
          }
          checked={audioOn}
          disabled={busy}
          onChange={(audio) => onChange({ ...options, audio })}
        />
        <SettingRow
          title="Ortak pano"
          detail="Mac’te kopyaladığın yazı telefona, telefonda kopyaladığın yazı Mac’e gelir."
          checked={options.clipboard !== false}
          disabled={busy}
          onChange={(clipboard) => onChange({ ...options, clipboard })}
        />
        <SettingRow
          title="Uyanık tut"
          detail={
            source === 'camera'
              ? 'Kamera penceresi telefonu kontrol etmez, bu yüzden ekranı uyanık tutamaz.'
              : 'Yansıma açıkken ve telefon şarjdayken ekran uykuya geçmez.'
          }
          checked={source !== 'camera' && options.stayAwake !== false}
          disabled={busy || source === 'camera'}
          onChange={(stayAwake) => onChange({ ...options, stayAwake })}
        />
        <SettingRow
          title="Otomatik kayıt"
          detail="Yansıma başlar başlamaz video, İndirilenler içindeki Scryno klasörüne mp4 olarak kaydedilir."
          checked={Boolean(options.record)}
          disabled={busy}
          onChange={(record) => onChange({ ...options, record })}
        />
      </div>

      <p className="quality-note">
        Android kartına veya yansıma penceresine dosya bırak. APK kurulur, diğer dosyalar telefonun
        İndirilenler klasörüne gider.
      </p>
    </div>
  )
}
