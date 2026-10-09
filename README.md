# SPEKTRUM — Güvenli Alan · Dayanışma · Özgürlük

LGBTİ+ dayanışma platformu. **Express + SQLite (node:sqlite)** backend'li, üyelik sistemi olan tam yığın (full-stack) bir uygulamadır.

## ✨ Özellikler

- **E-posta + parola ile kayıt / giriş** (scrypt parola karması, güvenli oturum çerezi)
- **Google ile giriş** (OAuth 2.0 — kurulum için aşağıya bak)
- **Demo hesapla keşif** (kayıt olmadan tek tıkla giriş)
- Giriş sonrası üyelere özel alan:
  - 💬 **Sohbet Merkezi**
    - 🌍 **Global sohbet** — tüm üyelerin katıldığı açık oda
    - ✉️ **Özel mesajlar (DM)** — iki kişilik gizli sohbetler; global sohbette veya toplulukta bir rumuza tıklayarak başlar
    - 🧠 **Psikolog destek kanalı** — üye ↔ uzman psikolog arasında gizli kanal; uzman tüm danışan sohbetlerini "gelen kutusu"nda görür, ilk temasta otomatik sıcak karşılama (acil hattı yönlendirmesiyle birlikte) gönderilir
  - 🤝 **Topluluk Duvarı** — rumuzla paylaşım, kategoriler, "Destek" tepkisi, yorumlar (yazar rumuzuna tıklayınca özel sohbet)
  - 💜 **Destek Talepleri** — psikolojik / hukuk / barınma talebi açma ve durum takibi
  - 🎒 **Destek Çantası** — üyenin kendi süreç sayfası; onay verdiğinde "yakın arkadaş profil linkleri"ni paylaşma/görme. Onay tek yönlüdür (bir kez verildi mi kalıcı); kapatma isteği yalnızca onaylı hesaplarda geçerli olur
  - 📚 **Kaynaklar** — güvenilir kurum ve yardım hatları
  - 🔔 **Bildirim Merkezi** — yeni özel mesaj, psikolog destek kanalı mesajı, paylaşımına gelen yorum ve destekler için zil ikonlu bildirim paneli
  - 👤 **Profil** — rumuz, isim, destek alanı düzenleme
- ⚡ **Hızlı Çıkış** butonu (acil durumlarda siteyi anında terk eder — bu tarz platformlar için kritik bir güvenlik özelliği)

## 🚀 Kurulum

```bash
npm install
npm start     # http://localhost:3000
```

Node.js **22.1+** gerektirir (yerleşik `node:sqlite` kullanılır; veritabanı `data/spektrum.db` dosyasında tutulur ve git'e eklenmez).

## 🔑 Google ile Giriş Kurulumu

1. [Google Cloud Console → Kimlik Bilgileri](https://console.cloud.google.com/apis/credentials) sayfasında **OAuth Client ID (Web uygulaması)** oluştur.
2. "Yetkili yönlendirme URI'leri"ne ekle: `http://localhost:3000/auth/google/callback` (canlıda `https://seninalanadin.com/auth/google/callback`).
3. `.env.example` dosyasını `.env` olarak kopyala ve doldur:

```
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
```

4. Sunucuyu yeniden başlat. (Anahtarlar tanımlı değilken sayfa, kurulum adımlarını gösteren bir bilgi ekranı açar; e-posta + parola akışı her koşulda çalışır.)

## 🎭 Demo Hesaplar

Geliştirmede kutudan çıkar bazı hesaplar (yalnızca yerel/demo kullanım için):

| Hesap | Rol | Giriş |
|---|---|---|
| Demo Keşif | Üye | Ana sayfadaki "Demo hesapla keşfet" butonu |
| `psikolog@spektrum.local` | 🧠 **Uzman psikolog** (`counselor`) | Parola: `spektrum2026` |

> Üretimde demo/uzman hesaplarının parolalarını değiştir veya kaldır. Uzman rolü API'den alınamaz; yalnızca veritabanından tanımlanır (`users.role = 'counselor'`).

## 📁 Dosya Yapısı

| Dosya | Görev |
|---|---|
| `server.js` | Express sunucusu, güvenlik başlıkları, statik dosyalar |
| `auth.js` | Kayıt / giriş / çıkış / Google OAuth / oturum |
| `api.js` | Topluluk, destek talepleri, destek çantası API'leri |
| `chat.js` | Global sohbet, özel mesaj (DM), psikolog destek kanalı API'leri |
| `db.js` | SQLite şeması + veri erişim katmanı |
| `index.html` | Açılış sayfası (giriş + kayıt) |
| `app.html` | Üye paneli (giriş sonrası) |

## 🔒 Güvenlik Notları

- Parolalar `scrypt` ile tuzlanmış olarak saklanır, asla düz metin değildir.
- Oturumlar httpOnly + SameSite çerez ile tutulur; 7 günde sonlanır.
- API'lerde parametreli sorgular (SQL injection koruması) ve hız sınırlama vardır.
- Kullanıcı içeriği arayüzde `textContent` ile işlenir (XSS koruması).
