import { forbidden, unauthorized } from '../lib/errors.js';
import { readCookie } from '../lib/http.js';
import { findSessionUser } from '../services/auth.js';

/** Her istekte oturum çerezini çözer; req.user ve req.sessionHash alanlarını doldurur. */
export function sessionMiddleware({ db, config }) {
  return (req, res, next) => {
    req.user = null;
    req.sessionHash = null;
    const session = findSessionUser(db, readCookie(req.headers.cookie, config.cookie.name));
    if (session) {
      req.user = session.user;
      req.sessionHash = session.tokenHash;
    }
    next();
  };
}

export const requireAuth = (req, res, next) => (req.user ? next() : next(unauthorized()));

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
