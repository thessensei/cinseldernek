/** Sunucu API'si için ince istemci. Tüm adresler göreli olmalıdır. */

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, url, body) {
  const init = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'network', 'Sunucuya ulaşılamıyor. Bağlantınızı kontrol edin.');
  }
  if (response.status === 204) return null;
  let text;
  try {
    text = await response.text();
  } catch {
    throw new ApiError(0, 'network', 'Sunucudan yanıt alınamadı. Lütfen tekrar deneyin.');
  }
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const info = data?.error ?? {};
    const error = new ApiError(
      response.status,
      info.code || 'error',
      info.message || 'Beklenmeyen bir hata oluştu.',
      info.details,
    );
    if (response.status === 401 && url !== '/api/auth/login' && url !== '/api/auth/register') {
      window.dispatchEvent(new CustomEvent('spektrum:unauthorized'));
    }
    throw error;
  }
  if (data === null) {
    throw new ApiError(response.status, 'bad_response', 'Sunucudan beklenmeyen bir yanıt alındı.');
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

/** URL'ye sorgu parametrelerini ekler; boş değerleri atlar. */
export function withQuery(url, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}
