/** API'den istemciye güvenle dönülebilen, bilinen hatalar. */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Oturum açmanız gerekiyor.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Bu işlem için yetkiniz yok.') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Kayıt') => new HttpError(404, 'not_found', `${what} bulunamadı.`);
export const conflict = (message) => new HttpError(409, 'conflict', message);
export const tooMany = (message = 'Çok fazla istek gönderdiniz. Lütfen biraz bekleyin.') =>
  new HttpError(429, 'rate_limited', message);
