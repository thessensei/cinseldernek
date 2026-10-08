const LOCALE = 'tr-TR';
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const shortDateFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });

export const formatTime = (iso) => timeFormat.format(new Date(iso));
export const formatDay = (iso) => dayFormat.format(new Date(iso));
export const formatDateTime = (iso) => dateTimeFormat.format(new Date(iso));
export const formatShortDate = (iso) => shortDateFormat.format(new Date(iso));

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso) {
  const diff = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  return formatDay(iso);
}

export function relativeTime(iso) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return 'az önce';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk önce`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} sa önce`;
  return formatDateTime(iso);
}

export function initials(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [...words[0]].slice(0, 1).concat([...words[1]].slice(0, 1));
  return letters.join('').toLocaleUpperCase('tr-TR');
}

export const ROLE_LABELS = { admin: 'Yönetici', moderator: 'Moderatör', user: 'Üye' };
export const REPORT_REASON_LABELS = {
  spam: 'Spam / reklam',
  taciz: 'Taciz',
  nefret: 'Nefret söylemi',
  cinsel_icerik: 'İstenmeyen cinsel içerik',
  tehdit: 'Tehdit',
  kendine_zarar: 'Kendine zarar',
  dolandiricilik: 'Dolandırıcılık',
  diger: 'Diğer',
};
export const HELP_AREA_LABELS = {
  psikolojik: '🧠 Psikolojik Destek',
  hukuk: '⚖️ Hukuki Danışmanlık',
  topluluk: '🤝 Topluluk & Sosyal Ağ',
  barinma: '🏠 Güvenli Barınma',
  gonullu: '🌈 Gönüllü Olmak İstiyorum',
};
export const STATUS_LABELS = { active: 'Aktif', banned: 'Yasaklı', deleted: 'Silinmiş' };
