const SAME_SITE = { lax: 'Lax', strict: 'Strict', none: 'None' };

export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function serializeCookie(name, value, { maxAgeSec, sameSite, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${SAME_SITE[sameSite] || 'Lax'}`];
  if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res, config, token, ttlMs) {
  res.append('Set-Cookie', serializeCookie(config.cookie.name, token, {
    maxAgeSec: Math.floor(ttlMs / 1000),
    sameSite: config.cookie.sameSite,
    secure: config.cookie.secure,
  }));
}

export function clearSessionCookie(res, config) {
  res.append('Set-Cookie', serializeCookie(config.cookie.name, '', {
    maxAgeSec: 0,
    sameSite: config.cookie.sameSite,
    secure: config.cookie.secure,
  }));
}
