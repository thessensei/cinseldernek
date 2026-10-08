# SPEKTRUM

LGBTİ+ bireyler, aileleri ve müttefikler için bir **dayanışma platformu**. Sohbet odaları, özel mesajlar, blog ve yönetim paneli tek bir Node.js uygulamasında çalışır.

SPEKTRUM tanıtım sayfasının (önceki `index.html`) görsel dili ve metinleri korunmuş, sayfa artık çalışan bir uygulamaya bağlanmıştır: giriş ve kayıt formları gerçek hesaplar oluşturur, giriş yapan üyeler sohbete geçer.

## Özellikler

### Üyelik ve oturum
- **Kayıt:** rumuz, e-posta, parola ve destek alanı. Rumuz 3–24 karakterdir (harf, rakam, `_ . -`). Gerçek adını paylaşmak zorunda değilsin.
- **Giriş:** e-posta veya rumuzla. Oturumlar 30 gün geçerlidir ve `HttpOnly` çerezle taşınır.
- **Parola değişikliği:** diğer tüm oturumları kapatır.
- **Hesap silme:** mesajların içeriği temizlenir, kimlik bilgileri anonimleştirilir.

### Sohbet
- **Odalar:** yönetici tarafından oluşturulur. *Salt okunur* odalara yalnızca moderatörler ve yöneticiler yazabilir; *arşivli* odalar üyelere gizlenir. Hazır odalar: Duyurular, Genel Sohbet, Psikolojik Destek, Hukuki Danışma, Güvenli Barınma ve Etkinlikler & Buluşmalar.
- **Özel mesajlar:** iki üye arasında tek bir konuşma vardır. Engelleme, her iki yönde özel mesajı kapatır.
- **Mesajlar:** gönderme, kendi mesajını düzenleme ve silme (oda mesajlarını moderatör ve yönetici de silebilir), "yazıyor" göstergesi, çevrimiçi durumu, okunmamış sayaçları ve sayfalı geçmiş (yukarı kaydırdıkça eski mesajlar yüklenir).
- Mesajdaki bağlantılar (`http`/`https`) otomatik tıklanabilir olur; ham HTML asla çalıştırılmaz.

### Blog
- Markdown ile yazılan yazılar; **taslak** veya **yayında** durumu.
- Türkçe karakterleri sadeleştiren otomatik bağlantı adları (slug), etiketler, kapak görseli bağlantısı ve görüntülenme sayacı.
- Arama, etiket filtresi ve yorumlar. Yorum yapmak için giriş gerekir; kendi yorumunuzu ya da (moderatör/yönetici olarak) herhangi bir yorumu silebilirsiniz.

### Güvenlik ve moderasyon
- **Şikayet:** mesajlar ve üyeler şikayet edilebilir. Aynı içerik için açık bir şikayetiniz varsa yeniden şikayet edemezsiniz.
- **Engelleme** ve **yasaklama** (moderatör veya yönetici tarafından, sebep belirtilerek). Yasaklanan kullanıcının bütün oturumları anında kapanır.
- **Moderasyon kuyruğu:** açık, çözüldü ve reddedildi sekmeleriyle.
- **Gizlilik:** yöneticiler özel mesaj içeriğini **yalnızca şikayet edilen mesajı ve öncesindeki en fazla 5 mesajı** görür. Bu kopya şikayet anında alınır ve şikayetin parçası olarak saklanır.
- Tüm yönetici ve moderatör eylemleri **denetim kaydına** (audit log) yazılır.

### Yönetim paneli (`/admin`)
- **Özet:** üye, çevrimiçi, mesaj, şikayet, yazı ve oda sayıları.
- **Kullanıcılar:** arama ve filtreler; yasaklama ve yasağı kaldırma. Rol değiştirme ve geçici parola üretme yalnızca yöneticilere açıktır.
- **Blog:** yazı ekleme, düzenleme ve silme; markdown için canlı önizleme.
- **Sohbet odaları:** oluşturma, düzenleme, arşivleme ve silme (yalnızca yönetici).
- **Şikayetler:** mesajı silme, kullanıcıyı yasaklama, ikisini birlikte uygulama veya reddetme; karar notu ile.
- **Denetim kaydı** ve **site ayarları** (duyuru bandı ve yeni kayıtları açma/kapatma), yalnızca yönetici.

## Hızlı başlangıç

Gereksinim: **Node.js 22 veya üzeri**. Tarayıcı tarafında derleme adımı yoktur. `better-sqlite3` için hazır ikili dosyalar kullanılır; bir derleme gerekirse C++ derleyicisi gerekir.

```bash
npm install
cp .env.example .env            # isteğe bağlı; değerleri düzenleyin
npm run seed -- --demo          # isteğe bağlı: odalar, örnek yazılar ve demo hesaplar
npm run create-admin            # yönetici hesabı (aşağıya bakın)
npm start                       # http://localhost:3000
```

Sunucu `.env` dosyasını kendiliğinden okumaz. Değişkenleri kabuğunuzda tanımlayabilir veya Node'un yerleşik desteğiyle çalıştırabilirsiniz:

```bash
node --env-file=.env server/index.js
```

### Yönetici hesabı

```bash
ADMIN_EMAIL=ben@ornek.com ADMIN_USERNAME=kurucu ADMIN_PASSWORD='en-az-8-karakter' npm run create-admin
```

Hesap yoksa oluşturulur; varsa yönetici yapılır ve parolası güncellenir. Parolayı komut satırı argümanı olarak değil, ortam değişkeni olarak verin; böylece shell geçmişine düşmez.

### Demo verisi

`npm run seed -- --demo` (veya `SEED_DEMO=1`) aşağıdaki hesapları ve örnek mesajları ekler.

> **Yalnızca geliştirme ve deneme içindir.** Canlı ortamda demo verisi eklemeyin; eklediyseniz bu hesapları silin ya da parolalarını değiştirin.

| Rumuz | Rol | Parola |
|---|---|---|
| `yonetici` | Yönetici | `Demo1234!` |
| `moderator` | Moderatör | `Demo1234!` |
| `ayla`, `deniz`, `mert` | Üye | `Demo1234!` |

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Dinlenecek port |
| `HOST` | `0.0.0.0` | Dinlenecek arayüz |
| `NODE_ENV` | `development` | `production` iken çerezler varsayılan olarak `Secure` olur ve statik dosyalar 1 saat önbelleğe alınır |
| `DB_PATH` | `data/app.db` | SQLite dosyası (WAL modunda çalışır; yanında `-wal` ve `-shm` dosyaları oluşur) |
| `COOKIE_SECURE` | `NODE_ENV=production` ise `true` | Oturum çerezine `Secure` ekler. HTTPS gerektirir |
| `COOKIE_SAMESITE` | `lax` | `lax`, `strict` veya `none`. `none` seçilirse çerez otomatik olarak `Secure` olur |
| `TRUST_PROXY` | kapalı | Ters vekil (nginx, Cloudflare vb.) arkasındaysanız vekil sayısı, ör. `1`. Yalnızca gerçekten vekil arkasındayken açın |
| `ALLOWED_ORIGINS` | boş | API'ye farklı bir alan adından erişiliyorsa virgülle ayrılmış tam origin listesi |
| `SEED_DEMO` | `0` | `1` ise `seed` komutu demo verisini de ekler |
| `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME` | — | `create-admin` komutu için |

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm start` | Sunucuyu başlatır |
| `npm run dev` | Dosya değişikliklerinde sunucuyu yeniden başlatır (`node --watch`) |
| `npm run seed` | Odaları ve örnek blog yazılarını ekler. Tekrar çalıştırmak güvenlidir |
| `npm run create-admin` | Yönetici hesabı oluşturur veya mevcut hesabı yönetici yapar |
| `npm test` | REST ve WebSocket testlerini çalıştırır. Geçici bir veritabanı kullanır |

## Roller ve yetkiler

| İşlem | Üye | Moderatör | Yönetici |
|---|:-:|:-:|:-:|
| Oda mesajı gönderme, kendi mesajını düzenleme | ✓ ¹ | ✓ | ✓ |
| Başkasının oda mesajını silme | | ✓ | ✓ |
| Özel mesajları görüntüleme | yalnızca taraflar | yalnızca şikayet anlık görüntüsü | yalnızca şikayet anlık görüntüsü |
| Şikayet etme | ✓ | ✓ | ✓ |
| Standart üyeyi yasaklama ve yasağı kaldırma | | ✓ | ✓ |
| Moderatör veya yöneticiyi yasaklama | | | ✓ |
| Rol değiştirme | | | ✓ |
| Geçici parola üretme | | | ✓ |
| Blog yazısı yönetimi ve yorum silme | | ✓ | ✓ |
| Oda oluşturma, düzenleme, silme | | | ✓ |
| Denetim kaydı ve site ayarları | | | ✓ |

¹ Salt okunur odalarda yalnızca moderatörler ve yöneticiler yazabilir.

Ek kurallar: yöneticiler kendi rollerini değiştiremez ve kendilerini yasaklayamaz. Sistemdeki son yönetici görevden alınamaz ya da yasaklanamaz. E-posta adresleri yalnızca yöneticilere gösterilir.

## Gerçek zamanlı katman

- Tarayıcı `/ws` adresine oturum çerezi ile bağlanır; bağlantıda kaynak (Origin / Sec-Fetch-Site) doğrulanır.
- Mesajlar REST ile gönderilir, WebSocket yalnızca iletir. Oda mesajları bağlı tüm üyelere, özel mesajlar yalnızca iki tarafa iletilir.
- Sunucu olayları: `hello`, `presence`, `message:new`, `message:updated`, `typing`, `rooms:changed`, `conversations:changed`, `user:updated`, `settings:changed`, `reports:changed`, `auth:revoked`.
- Bağlantı koparsa 1 saniye ile 15 saniye arasında geri çekilerek yeniden bağlanılır; kaçırılan mesajlar `after=` imleciyle tamamlanır. WebSocket 10 saniyeden uzun süre kapalı kalırsa 4 saniyede bir yoklama yapılır.
- Oturumu sonlandırılan ya da yasaklanan kullanıcının bağlantısı `4001` / `4003` koduyla kapatılır ve istemci yeniden bağlanmaya çalışmaz.

## Güvenlik

- **Parolalar:** scrypt ile özetlenir (`N=16384, r=8, p=1`, her kullanıcıya özel tuz). Kullanıcı bulunamadığında da aynı maliyette doğrulama yapılır; böylece kayıtlı rumuzlar ayırt edilemez.
- **Oturumlar:** 32 baytlık rastgele belirteç. Veritabanında yalnızca SHA-256 özeti tutulur. Çerez `HttpOnly` ve `SameSite` ile gelir.
- **CSRF ve kaynak doğrulama:** tarayıcının `Sec-Fetch-Site` başlığı (yoksa `Origin`) aynı kaynağı göstermiyorsa istek reddedilir. Değişiklik yapan istekler JSON olmak zorundadır.
- **Başlıklar:** `Content-Security-Policy` (betikler yalnızca kendi kaynağından), `X-Content-Type-Options`, `Referrer-Policy`. Çerçeveleme engeli (`X-Frame-Options` / `frame-ancestors`) bilinçli olarak gönderilmez; uygulama önizleme ve gömme senaryolarında çalışabilsin diye. Gerekirse eklenebilir.
- **Markdown:** blog ve önizleme ham HTML'i işlemez. Bağlantılar `rel="noopener noreferrer nofollow"` ile açılır.
- **Hız sınırları** (bellek içinde): giriş, kayıt, mesaj, şikayet, yorum ve yazıyor bildirimi için. Ayrıntılar `server/config.js` dosyasında. Birden fazla süreç çalıştırırsanız sınırlar süreçler arasında paylaşılmaz.
- **Üretim önerileri:** HTTPS arkasında çalıştırın, `COOKIE_SECURE=true` kullanın, ters vekil arkasındaysanız `TRUST_PROXY=1` verin ve `data/` dizinini düzenli olarak yedekleyin.

## Testler

```bash
npm test
```

REST uç noktalarını ve WebSocket akışlarını kapsar: oda yayını, özel mesajların izolasyonu, yazıyor göstergesi, yasaklama ve oturum kapatmada bağlantıların kesilmesi. Testler geçici bir SQLite dosyası kullanır ve `data/` dizinine dokunmaz.

## Proje yapısı

```
server/
  index.js            Başlatıcı (dinleme ve kapanış sinyalleri)
  server.js           HTTP, WebSocket ve veritabanını birleştirir
  app.js              Express uygulaması, güvenlik başlıkları, hata yönetimi
  config.js           Ortam değişkenlerinden yapılandırma
  seed-data.js        Hazır odalar, örnek yazılar ve demo hesaplar
  db/                 SQL migrasyonları (PRAGMA user_version) ve bağlantı
  lib/                Hatalar, doğrulama (zod), parola (scrypt), hız sınırı, markdown
  middleware/         Oturum, rol kontrolü, kaynak doğrulama
  routes/             REST uç noktaları: auth, me, users, rooms, dms, messages, reports, blog, admin
  services/           İş kuralları: sohbet, moderasyon, blog, şikayetler, ayarlar, denetim
  realtime/           WebSocket hub'ı ve çevrimiçi durumu
  scripts/            seed.js ve create-admin.js
public/
  index.html          Tek sayfa uygulama kabuğu
  assets/css/app.css  Tasarım sistemi
  assets/js/          ES modülleri: core/ (API, yönlendirici, WebSocket), components/, views/
tests/                node:test ile REST ve WebSocket testleri
```

Kullanılan teknolojiler: Express 5, better-sqlite3, ws, zod, markdown-it ve Node.js'in yerleşik `node:test` modülü. Tarayıcı tarafında derleyici ya da paket yöneticisi gerekmez.

## Sınırlamalar (v1)

Bu sürümde bilerek yer almayan özellikler:

- **E-posta doğrulama ve e-posta ile parola sıfırlama yoktur.** Parolasını unutan üye için yönetici geçici parola üretir.
- **İki faktörlü doğrulama** yoktur.
- **Görsel yükleme** yoktur; kapak görseli için dış bağlantı kullanılır.
- **Mesaj arama** yoktur.
- Hız sınırları ve gerçek zamanlı durum tek süreçte bellekte tutulur. Yatay ölçekleme için paylaşılan bir katman (ör. Redis) gerekir.
- SQLite tek düğümlü bir veritabanıdır; yoğun eşzamanlı yazma için uygun değildir.

## Lisans

Henüz belirlenmedi (`package.json` içinde `UNLICENSED`).
