// Başlangıç verileri: odalar, örnek blog yazıları ve (isteğe bağlı) demo hesaplar.

export const DEFAULT_ROOMS = [
  { slug: 'duyurular', name: 'Duyurular', description: 'Yönetim duyuruları. Yalnızca yöneticiler yazabilir.', isReadonly: true, sortOrder: 0 },
  { slug: 'genel', name: 'Genel Sohbet', description: 'Herkesin katılabileceği açık sohbet odası. Saygılı olalım.', sortOrder: 1 },
  { slug: 'psikolojik-destek', name: 'Psikolojik Destek', description: 'Duygularını paylaş, yalnız değilsin. Acil bir durumda 112\'yi ara.', sortOrder: 2 },
  { slug: 'hukuki-danisma', name: 'Hukuki Danışma', description: 'Hukuki sorularını paylaş; gönüllü destekçilerimiz yardımcı olabilir.', sortOrder: 3 },
  { slug: 'guvenli-barinma', name: 'Güvenli Barınma', description: 'Acil barınma ihtiyacı olanlar için yönlendirme ve dayanışma.', sortOrder: 4 },
  { slug: 'etkinlikler', name: 'Etkinlikler & Buluşmalar', description: 'Yaklaşan etkinlikler, söyleşiler ve buluşmalar.', sortOrder: 5 },
];

export const SAMPLE_POSTS = [
  {
    title: "SPEKTRUM'a hoş geldin",
    excerpt: 'Burası güvenli bir alan. Neler yapabileceğini ve kendini nasıl koruyabileceğini kısaca anlatıyoruz.',
    tags: ['duyuru', 'rehber'],
    bodyMd: `# SPEKTRUM'a hoş geldin 🏳️‍🌈

SPEKTRUM, LGBTİ+ bireyler, aileleri ve müttefikleri için kurulmuş bir **dayanışma ağıdır**. Burada:

- 💬 **Sohbet odalarında** topluluğa katılabilir, sorularını paylaşabilirsin.
- 🔒 **Özel mesajlarla** tek tek birine ulaşabilirsin.
- 📰 **Blogda** rehberler, duyurular ve hikâyeler okuyabilirsin.

Her kimlik onurludur. Saygı ve gizlilik bu topluluğun temelidir.

> Acil bir durumdaysan lütfen **112**'yi ara.`,
  },
  {
    title: 'Güvenli sohbet için 5 ipucu',
    excerpt: 'Kişisel bilgilerini nasıl koruyacağını, rahatsız edici kullanıcılarla nasıl başa çıkacağını öğren.',
    tags: ['güvenlik', 'rehber'],
    bodyMd: `Çevrimiçi sohbetlerde kendini güvende hissetmen herkesten önemli. İşte pratik öneriler:

## 1. Kişisel bilgilerini korumaya özen göster
Adres, iş yeri, okul ve sağlık bilgilerini herkesle paylaşmak zorunda değilsin. Yeni tanıştığın birine karşı acele etme.

## 2. Rumuzunu seç
Gerçek adın yerine bir rumuz kullanabilirsin. Profilindeki görünen adı istediğin zaman değiştirebilirsin.

## 3. Engelle ve şikayet et
Rahatsız edici bir kullanıcıyla karşılaşırsan **Engelle** düğmesini kullan. Kötüye kullanım gördüğünde **Şikayet et** ile moderatörlere haber ver. Şikayetler gizli tutulur.

## 4. Bağlantılara dikkat et
Tanımadığın kişilerin gönderdiği bağlantılara tıklamadan önce emin ol.

## 5. Yardım iste
Psikolojik destek, hukuki danışma ve barınma odalarımız seni destekleyecek gönüllülerle dolu.`,
  },
  {
    title: 'Topluluk kuralları',
    excerpt: 'Herkesin güvenle konuşabilmesi için birlikte uyduğumuz temel kurallar.',
    tags: ['kurallar'],
    bodyMd: `Herkesin güvenle konuşabilmesi için şu kurallara uyuyoruz:

1. **Saygı:** Kimliğe, cinsel yönelime, cinsiyet ifadesine, etnik kökene, dine veya engel durumuna yönelik nefret söylemi yasaktır.
2. **Taciz ve tehdit yok:** Israr, tehdit, ifşa ve istenmeyen cinsel içerik paylaşımı kesinlikle yasaktır.
3. **Gizlilik:** Başkalarının kişisel bilgilerini izinsiz paylaşma.
4. **Reklam ve spam yok.**
5. **Moderatör kararlarına saygı:** Hatalı bir karar gördüğünde yöneticilere ulaşabilirsin.

Kuralları ihlal eden içerikler kaldırılır ve hesaplar askıya alınabilir.`,
  },
];

export const DEMO_PASSWORD = 'Demo1234!';

export const DEMO_USERS = [
  { username: 'yonetici', email: 'yonetici@example.com', displayName: 'Yönetici', role: 'admin', bio: 'SPEKTRUM yönetim ekibi.' },
  { username: 'moderator', email: 'moderator@example.com', displayName: 'Moderatör Deniz', role: 'moderator', bio: 'Topluluğu sakin ve güvenli tutmaya çalışıyorum.' },
  { username: 'ayla', email: 'ayla@example.com', displayName: 'Ayla', role: 'user', bio: 'Yeni katıldım, tanışmak güzel!' },
  { username: 'deniz', email: 'deniz@example.com', displayName: 'Deniz', role: 'user', bio: 'Müzik, kahve ve dayanışma.' },
  { username: 'mert', email: 'mert@example.com', displayName: 'Mert', role: 'user', bio: 'Hukuk öğrencisi, gönüllü.' },
];

export const DEMO_MESSAGES = [
  { room: 'duyurular', user: 'yonetici', body: "SPEKTRUM'a hoş geldiniz! Topluluk kurallarını blogdan okuyabilirsiniz." },
  { room: 'genel', user: 'ayla', body: 'Merhaba herkese! Yeni katıldım 🌈' },
  { room: 'genel', user: 'deniz', body: 'Hoş geldin Ayla! Burada herkes çok samimi.' },
  { room: 'genel', user: 'mert', body: 'Bu hafta sonu bir buluşma planı var mı?' },
  { room: 'genel', user: 'moderator', body: 'Etkinlikler odasını takip edebilirsiniz, duyuruları oraya ekliyoruz.' },
  { room: 'psikolojik-destek', user: 'ayla', body: 'Bugün biraz zor bir gündü, konuşacak biri arıyorum.' },
  { room: 'psikolojik-destek', user: 'deniz', body: 'Buradayım, anlatmak istersen dinliyorum.' },
];

export const DEMO_DM = [
  { from: 'ayla', body: 'Deniz, sana özel yazabilir miyim?' },
  { from: 'deniz', body: 'Tabii! Buradayım.' },
  { from: 'ayla', body: 'Teşekkür ederim, bu topluluk gerçekten iyi hissettiriyor.' },
];
