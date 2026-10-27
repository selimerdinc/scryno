import { useState, type JSX } from 'react'
import type { DeviceInfo } from '../../../shared/types'
import {
  IconAndroid,
  IconApple,
  IconCamera,
  IconDeviceScreen,
  IconFolder,
  IconSparkle,
  IconVideo
} from './icons'

interface DualStudioProps {
  androidDevice: DeviceInfo | null
  iosDevice: DeviceInfo | null
  busy: boolean
  recording?: boolean
  onTakeDualScreenshot: (mode: 'mockup' | 'raw') => Promise<void>
  onToggleDualRecord?: () => Promise<void>
  onOpenFolder: () => Promise<void>
  onOpenDesktopToolbar?: () => Promise<void>
}

export function DualStudio({
  androidDevice,
  iosDevice,
  busy,
  recording = false,
  onTakeDualScreenshot,
  onToggleDualRecord,
  onOpenFolder,
  onOpenDesktopToolbar
}: DualStudioProps): JSX.Element | null {
  const [mode, setMode] = useState<'mockup' | 'raw'>('mockup')

  if (!androidDevice || !iosDevice) {
    return null
  }

  return (
    <section className="dual-studio-card" aria-label="Dual Studio">
      <div className="dual-studio-glow" aria-hidden="true" />

      <div className="dual-studio-top">
        <div className="dual-studio-brand">
          <span className="dual-studio-tag">
            <IconSparkle size={14} />
            Dual Studio
          </span>
          <div className="dual-studio-devices">
            <span className="dual-device-pill android">
              <IconAndroid size={14} />
              <span className="device-name" title={androidDevice.name || androidDevice.id}>
                {androidDevice.name || 'Android'}
              </span>
            </span>
            <span className="dual-pair-divider">×</span>
            <span className="dual-device-pill ios">
              <IconApple size={14} />
              <span className="device-name" title={iosDevice.name || iosDevice.id}>
                {iosDevice.name || 'iPhone'}
              </span>
            </span>
          </div>
        </div>

        <div className="dual-mode-selector" role="radiogroup" aria-label="Görsel Formatı">
          <button
            type="button"
            className={`mode-btn ${mode === 'mockup' ? 'active' : ''}`}
            onClick={() => setMode('mockup')}
            title="Koyu aurora şablonu, gölge ve etiketlerle sunum formatı"
          >
            ✨ Şablonlu Mockup
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === 'raw' ? 'active' : ''}`}
            onClick={() => setMode('raw')}
            title="Yalnızca ekranların kenarlıksız saf birleşimi"
          >
            🔲 Saf Birleşim
          </button>
        </div>
      </div>

      <div className="dual-studio-bottom">
        <div className="dual-actions-group">
          <button
            type="button"
            className="btn btn-primary dual-ss-btn"
            disabled={busy}
            onClick={() => void onTakeDualScreenshot(mode)}
            title="Her iki cihazdan aynı anda ekran görüntüsü alıp birleştirir ve panoya kopyalar"
          >
            <IconCamera size={16} />
            Yan Yana Screenshot Al
          </button>

          {onToggleDualRecord && (
            <button
              type="button"
              className={`btn ${recording ? 'btn-danger recording-pulse' : 'btn-secondary'} dual-rec-btn`}
              disabled={busy}
              onClick={() => void onToggleDualRecord()}
              title={recording ? 'Kaydı Durdur ve Kaydet' : 'Her iki cihazı yan yana kaydet'}
            >
              <IconVideo size={16} live={recording} />
              {recording ? 'Kaydı Bitir' : 'Yan Yana Video Kaydet'}
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onOpenFolder()}
            title="İndirilenler/Scryno klasörünü aç"
          >
            <IconFolder size={16} />
            Kayıtlar
          </button>

          {onOpenDesktopToolbar && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void onOpenDesktopToolbar()}
              title="Masaüstünde telefonların hemen yanına kayan toolbar açar"
            >
              <IconDeviceScreen size={16} />
              Telefonların Yanına Toolbar Aç
            </button>
          )}
        </div>

        <div className="dual-hint-text">
          <span>Kısayol: Tek tıkla panoya kopyalanır ve diske kaydedilir</span>
        </div>
      </div>
    </section>
  )
}
