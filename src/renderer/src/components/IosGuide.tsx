import type { JSX } from 'react'
import type { DeviceInfo } from '../../../shared/types'

interface IosGuideProps {
  busy: boolean
  iosAvailable: boolean
  iosDevices: DeviceInfo[]
  onPair: (udid: string) => void
}

export function IosGuide(props: IosGuideProps): JSX.Element {
  const { busy, iosAvailable, iosDevices, onPair } = props
  const selected = iosDevices.find((device) => device.iosPaired === false) || iosDevices[0] || null

  if (!iosAvailable) {
    return (
      <ol className="steps">
        <li>
          <div className="step-title">libimobiledevice kur</div>
          <div className="step-body">
            Terminalde <code>brew install libimobiledevice</code> çalıştır, sonra Scryno’yu yenile.
          </div>
        </li>
      </ol>
    )
  }

  return (
    <ol className="steps">
      <li>
        <div className="step-title">Kabloyla bağla ve güven</div>
        <div className="step-body">
          iPhone’u kabloyla bağla, telefonda <strong>Bu bilgisayara güven?</strong> → Güven.
          {iosDevices.length > 0 ? ` (${iosDevices.length} cihaz bulundu)` : ''}
        </div>
      </li>
      <li>
        <div className="step-title">Eşleştir</div>
        <div className="step-body">
          {selected
            ? selected.iosPaired
              ? `${selected.name} eşleşmiş durumda.`
              : `${selected.name} için eşleştirme gerekiyor.`
            : 'Henüz iPhone görünmüyor.'}
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy || !selected}
          onClick={() => {
            if (selected) {
              onPair(selected.id)
            }
          }}
        >
          Eşleştir / doğrula
        </button>
      </li>
      <li>
        <div className="step-title">iPhone Mirroring ile yansıt</div>
        <div className="step-body">
          Kartta <strong>Yansıt</strong>’a bas. Scryno macOS iPhone Mirroring’i açar ve kontrol barını
          pencerenin üstüne yapıştırır. Dokunma ve klavye doğrudan çalışır.
        </div>
      </li>
      <li>
        <div className="step-title">İzinler</div>
        <div className="step-body">
          Sistem Ayarları → Gizlilik ve Güvenlik → <strong>Ekran Kaydı</strong> (ekran görüntüsü ve
          video) ve <strong>Erişilebilirlik</strong> (barı sürükleyip taşımak).
          {selected?.iosScreenshotHint ? (
            <>
              <br />
              <span className="step-hint">{selected.iosScreenshotHint}</span>
            </>
          ) : null}
        </div>
      </li>
    </ol>
  )
}
