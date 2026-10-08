export const nowIso = () => new Date().toISOString();

const TR_CHARS = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Türkçe karakterleri sadeleştirip URL dostu bir slug üretir. */
export function slugify(input) {
  return String(input ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (ch) => TR_CHARS[ch])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export const normalizeUsername = (value) => String(value).normalize('NFC').trim().toLocaleLowerCase('tr-TR');
export const normalizeEmail = (value) => String(value).trim().toLowerCase();

/** Kontrol karakterlerini temizler, satır sonlarını normalleştirir. */
export function cleanMessageBody(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export const codePointLength = (value) => [...value].length;

/** LIKE sorguları için kaçışlanmış desen. Kullanırken `LIKE_ESCAPE` eklenmelidir. */
export const LIKE_ESCAPE = "ESCAPE '\\'";
export const likePattern = (term) => `%${String(term).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
