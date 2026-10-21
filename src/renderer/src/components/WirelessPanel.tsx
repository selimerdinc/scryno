import { useMemo, useState, type JSX } from 'react'

type WirelessMode = 'modern' | 'classic'

interface WirelessPanelProps {
  busy: boolean
  selectedUsbDeviceId: string | null
  onConnect: (endpoint: string) => void
  onPair: (endpoint: string, code: string) => void
  onDisconnect: (endpoint?: string) => void
  onEnableTcpip: (deviceId: string) => void
}

export function WirelessPanel(props: WirelessPanelProps): JSX.Element {
  const { busy, selectedUsbDeviceId, onConnect, onPair, onDisconnect, onEnableTcpip } = props
  const [mode, setMode] = useState<WirelessMode>('modern')
  const [pairEndpoint, setPairEndpoint] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [connectEndpoint, setConnectEndpoint] = useState('')
  const [classicEndpoint, setClassicEndpoint] = useState('')

  const canUsbToWifi = useMemo(
    () => Boolean(selectedUsbDeviceId && !selectedUsbDeviceId.includes(':')),
    [selectedUsbDeviceId]
  )

  return (
    <div className="wireless-panel">
      <div className="mode-tabs" role="tablist" aria-label="Kablosuz yöntem">
        <button
          type="button"
          role="tab"
          className={`mode-tab ${mode === 'modern' ? 'active' : ''}`}
          aria-selected={mode === 'modern'}
          disabled={busy}
          onClick={() => setMode('modern')}
        >
          Android 11+ · Kod
        </button>
        <button
          type="button"
          role="tab"
          className={`mode-tab ${mode === 'classic' ? 'active' : ''}`}
          aria-selected={mode === 'classic'}
          disabled={busy}
          onClick={() => setMode('classic')}
        >
          USB → Wi‑Fi
        </button>
      </div>

      {mode === 'modern' ? (
        <ol className="steps">
          <li>
            <div className="step-title">Telefonda kablosuz hata ayıklamayı aç</div>
            <div className="step-body">
              Ayarlar → Geliştirici seçenekleri → <strong>Kablosuz hata ayıklama</strong> → aç →{' '}
              <strong>Eşleştirme koduyla eşleştir</strong>. Android’in QR eşleştirmesi standart ADB
              komutunda sunulmadığı için Scryno güvenilir 6 haneli kod yöntemini kullanır.
            </div>
          </li>
          <li>
            <div className="step-title">Eşleştir (bir kez)</div>
            <div className="step-body">
              Telefondaki <strong>IP adresi ve bağlantı noktası</strong> ile{' '}
              <strong>6 haneli kodu</strong> yaz, Eşleştir’e bas.
            </div>
            <div className="wireless-grid">
              <div className="field">
                <label htmlFor="pairEndpoint">Eşleştirme IP:port</label>
                <input
                  id="pairEndpoint"
                  type="text"
                  placeholder="192.168.1.10:37123"
                  value={pairEndpoint}
                  disabled={busy}
                  onChange={(event) => setPairEndpoint(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="pairingCode">6 haneli kod</label>
                <input
                  id="pairingCode"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={pairingCode}
                  disabled={busy}
                  onChange={(event) =>
                    setPairingCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                />
              </div>
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy || !pairEndpoint.trim() || pairingCode.length !== 6}
              onClick={() => onPair(pairEndpoint, pairingCode)}
            >
              1 · Eşleştir
            </button>
          </li>
          <li>
            <div className="step-title">Bağlan</div>
            <div className="step-body">
              Aynı ekranda görünen <strong>IP adresi ve bağlantı noktası</strong> değerini yaz
              (eşleştirme portundan farklı olabilir), Bağlan’a bas. Sonra cihaz listesini yenile.
            </div>
            <div className="field">
              <label htmlFor="connectEndpoint">Bağlantı IP:port</label>
              <input
                id="connectEndpoint"
                type="text"
                placeholder="192.168.1.10:5555"
                value={connectEndpoint}
                disabled={busy}
                onChange={(event) => setConnectEndpoint(event.target.value)}
              />
            </div>
            <div className="device-actions wireless-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !connectEndpoint.trim()}
                onClick={() => onConnect(connectEndpoint)}
              >
                2 · Bağlan
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => onDisconnect(connectEndpoint.trim() || undefined)}
              >
                Bağlantıyı kes
              </button>
            </div>
          </li>
        </ol>
      ) : (
        <ol className="steps">
          <li>
            <div className="step-title">USB ile bağla</div>
            <div className="step-body">
              Telefonu kabloyla bağla, USB hata ayıklamayı aç, listeden cihazı seç (wifi rozeti
              olmamalı).
            </div>
          </li>
          <li>
            <div className="step-title">TCP/IP modunu aç</div>
            <div className="step-body">
              Seçili USB cihazında kablosuz ADB portunu (5555) açar. Kabloyu sonra çıkarabilirsin.
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy || !canUsbToWifi}
              title={
                canUsbToWifi
                  ? 'adb tcpip 5555'
                  : 'Önce listeden USB ile bağlı bir Android cihaz seç'
              }
              onClick={() => {
                if (selectedUsbDeviceId) {
                  onEnableTcpip(selectedUsbDeviceId)
                }
              }}
            >
              1 · USB → Wi‑Fi aç
            </button>
          </li>
          <li>
            <div className="step-title">IP ile bağlan</div>
            <div className="step-body">
              Telefonun Wi‑Fi IP adresini yaz (genelde Ayarlar → Wi‑Fi → ağ detayı). Port yoksa 5555
              eklenir.
            </div>
            <div className="field">
              <label htmlFor="classicEndpoint">Telefon IP (veya IP:5555)</label>
              <input
                id="classicEndpoint"
                type="text"
                placeholder="192.168.1.10"
                value={classicEndpoint}
                disabled={busy}
                onChange={(event) => setClassicEndpoint(event.target.value)}
              />
            </div>
            <div className="device-actions wireless-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !classicEndpoint.trim()}
                onClick={() => onConnect(classicEndpoint)}
              >
                2 · Bağlan
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => onDisconnect(classicEndpoint.trim() || undefined)}
              >
                Bağlantıyı kes
              </button>
            </div>
          </li>
        </ol>
      )}
    </div>
  )
}
