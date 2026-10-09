# SPEKTRUM — Güvenli Alan · Dayanışma · Özgürlük

SPEKTRUM; topluluk duvarı, sohbet, destek talebi ve güvenilir kaynaklar sunan Türkçe bir dayanışma platformudur. Ön yüz sade HTML/CSS/JavaScript olarak, sunucu Express ve yerleşik SQLite (`node:sqlite`) ile çalışır.

## Gereksinimler

- Node.js **22.1 veya üzeri**
- npm

## Kurulum ve çalıştırma

```bash
npm install
npm run dev       # http://localhost:3000 — geliştirme hesabı ve demo açık
```

Üretimde `NODE_ENV=production npm start` kullan. Veritabanı varsayılan olarak `data/spektrum.db` içinde oluşturulur; bu klasör Git dışında tutulur. `DATABASE_PATH` ile farklı bir dosya yolu seçilebilir.

## Neler var?

- E-posta ve parola ile kayıt/giriş; scrypt parola karması ve httpOnly oturum çerezi
- Geliştirme ortamında tek tık demo hesap
- Topluluk duvarı, kategoriler, destek tepkileri ve yorumlar
- Global sohbet, özel mesaj ve üye-uzman destek kanalı
- Üyenin kendi destek taleplerini ve durumunu takip etmesi; uzman hesabında yetki kontrollü gelen talep kuyruğu ve durum güncelleme
- Kişisel destek çantası ve isteğe bağlı, geri alınabilir bağlantı paylaşımı
- Kaynaklar, bildirimler, profil ayarları ve hızlı çıkış
- Mobil uyumlu arayüz ve temel erişilebilirlik desteği

## Uzman hesabı

Bilinen örnek parolalı uzman hesabı **yalnızca** `npm run dev` ile (`NODE_ENV=development`) oluşturulur: `psikolog@spektrum.local` / `spektrum2026`. Bu kimlik bilgileri yerel geliştirme içindir; üretimde varsayılan hesap etkinleştirilmez. Uzman girişini yapılandırmak için `.env` içinde kendi hesabını tanımla:

```dotenv
COUNSELOR_NAME=SPEKTRUM Uzman Ekibi
COUNSELOR_EMAIL=uzman@ornek.org
COUNSELOR_PASSWORD=uzun-ve-rastgele-bir-parola
```

Parola en az 12 karakter olmalıdır. Sunucu bu e-postayı uzman rolüyle oluşturur veya var olan hesabı yapılandırmaya göre günceller. Üretimde bu parolayı güvenli bir sır yöneticisinde tut; gerçek kullanıcı verisiyle geliştirme/demo ortamını paylaşma.

## Google ile giriş (isteğe bağlı)

1. Google Cloud Console'da bir OAuth Client ID (Web) oluştur.
2. Yönlendirme URI'si olarak `https://alan-adin/auth/google/callback` (yerelde `http://localhost:3000/auth/google/callback`) ekle.
3. `.env` dosyasında `GOOGLE_CLIENT_ID` ve `GOOGLE_CLIENT_SECRET` değerlerini tanımlayıp sunucuyu yeniden başlat.

Google yapılandırılmadığında Google düğmesi arayüzde gösterilmez; e-posta/parola girişi çalışmaya devam eder.

## Üretim ayarları

`.env.example` dosyasını `.env` olarak kopyala. Üretimde en azından:

```dotenv
NODE_ENV=production
PORT=3000
COUNSELOR_EMAIL=uzman@ornek.org
COUNSELOR_PASSWORD=uzun-ve-rastgele-bir-parola
```

Demo hesabı üretimde varsayılan olarak kapalıdır. Açılması gerekiyorsa bilinçli olarak `ENABLE_DEMO=true` ayarla. Üretim veritabanı için düzenli yedekleme ve uygun erişim izinleri yapılandır.

> SPEKTRUM acil servis değildir ve çevrim içi yanıt süresi garanti etmez. Yakın tehlikede çevrim içi yanıtı bekleme; Türkiye'de acil yardım için 112'yi, sosyal destek için ALO 183'ü ara. Hiçbir çevrim içi hizmet mutlak gizlilik garantisi veremez; hassas bilgileri paylaşırken bunu göz önünde bulundur.

## Dosya yapısı

| Dosya | Görev |
|---|---|
| `server.js` | Express sunucusu, güvenlik başlıkları ve `public/` statik sunumu |
| `auth.js` | Kayıt, giriş, çıkış, Google OAuth ve oturum yönetimi |
| `api.js` | Profil, topluluk, talepler, destek çantası ve kaynak API'leri |
| `chat.js` | Sohbet ve mesaj API'leri |
| `db.js` | SQLite şeması, veri erişimi ve başlangıç verileri |
| `public/index.html` | Açılış ve kimlik doğrulama sayfası |
| `public/app.html` | Üye paneli kabuğu |
| `public/styles.css` | Paylaşılan, duyarlı arayüz stilleri |
| `public/landing.js` / `public/app.js` | Açılış ve üye paneli etkileşimleri |

## Kontroller

```bash
npm test           # İzole SQLite dosyasıyla uçtan uca temel duman testleri
npm run check      # Sunucu ve tarayıcı JavaScript sözdizimi kontrolü
```
