import { HttpError } from './errors.js';

/** Zod şemasıyla doğrular; ilk hatayı Türkçe mesaj olarak fırlatır. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  throw new HttpError(400, 'validation_error', issues[0]?.message || 'Geçersiz istek.', issues);
}

/** URL parametresini pozitif tam sayıya çevirir; geçersizse 404 döner. */
export function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'not_found', 'Kayıt bulunamadı.');
  return id;
}
