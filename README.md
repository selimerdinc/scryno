# Scryno

Ücretsiz Android ve iPhone yansıtma uygulaması. Hesap, lisans anahtarı ve ödeme yok.

Android görüntüsü Scryno penceresinin içinde açılır. iPhone, macOS iPhone Mirroring üzerinden açılır. Uygulama kapanınca her iki yansıma da kapanır.

## Kurulum

macOS Apple Silicon için hazır paket:

```bash
npm run dist:mac
```

Çıktı `release/Scryno-1.0.0-arm64.dmg` dosyasıdır. İlk açılışta macOS, geliştirici imzası olmadığı için uygulamayı durdurabilir. Uygulamaya sağ tıklayıp **Aç** demek yeterlidir. Ekran Kaydı, Erişilebilirlik ve Otomasyon izinleri istendiğinde Scryno’ya izin ver.

Windows kurulumu:

```bash
npm run dist:win
```

## Geliştirme

- Node.js 22 veya 24
- Android telefonda USB hata ayıklama
- iPhone için macOS ve kabloyla “Bu bilgisayara güven”

```bash
npm install
npm run fetch-binaries
npm run dev
```

## Sürüm 1.0

- Android yansıtma, dokunma, klavye, pano, dosya bırakma, kamera ve sanal ekran
- Kalıcı görüntü ve kayıt ayarları
- Kablosuz Android bağlantısı, 6 haneli eşleştirme koduyla
- iPhone Mirroring, büyütme, otomatik kayıt ve pencereyi geri getirme
