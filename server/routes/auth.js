import { Router } from 'express';
import { forbidden, tooMany, unauthorized, conflict } from '../lib/errors.js';
import { clearSessionCookie, setSessionCookie } from '../lib/http.js';
import { schemas } from '../lib/schemas.js';
import { DUMMY_HASH, verifyPassword } from '../lib/passwords.js';
import { parse } from '../lib/validate.js';
import { createSession } from '../services/auth.js';
import { getSettings } from '../services/settings.js';
import { createUser, findLoginRow, findUserConflict, getUserRow, toSelfUser } from '../services/users.js';

export function authRoutes(ctx) {
  const { db, config, limiters } = ctx;
  const router = Router();

  router.get('/me', (req, res) => {
    res.json({ user: req.user ? toSelfUser(req.user) : null });
  });

  router.post('/register', async (req, res) => {
    if (getSettings(db).registration_open !== '1') throw forbidden('Yeni kayıtlar şu anda kapalı.');
    if (!limiters.register.hit(`register:${req.ip}`)) {
      throw tooMany('Çok fazla kayıt denemesi yaptınız. Lütfen daha sonra tekrar deneyin.');
    }
    const input = parse(schemas.register, req.body);
    if (findUserConflict(db, input.username, input.email)) {
      throw conflict('Bu rumuz veya e-posta zaten kullanılıyor.');
    }
    const user = await createUser(db, input);
    const session = createSession(db, user.id, {
      ttlMs: config.sessionTtlMs,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    setSessionCookie(res, config, session.token, config.sessionTtlMs);
    res.status(201).json({ user: toSelfUser(user) });
  });

  router.post('/login', async (req, res) => {
    const input = parse(schemas.login, req.body);
    const pairKey = `login:${req.ip}|${input.identifier.toLocaleLowerCase('tr-TR')}`;
    const ipKey = `loginip:${req.ip}`;
    if (limiters.login.isLimited(pairKey) || limiters.loginIp.isLimited(ipKey)) {
      throw tooMany('Çok fazla başarısız deneme yaptınız. Lütfen 15 dakika sonra tekrar deneyin.');
    }
    const row = findLoginRow(db, input.identifier);
    // Kullanıcı bulunamasa bile aynı maliyette doğrulama yapılır (kullanıcı adı sızıntısını önler).
    const valid = await verifyPassword(input.password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !valid) {
      limiters.login.hit(pairKey);
      limiters.loginIp.hit(ipKey);
      throw unauthorized('E-posta/rumuz veya parola hatalı.');
    }
    if (row.status === 'banned') {
      throw forbidden(row.ban_reason ? `Hesabınız askıya alınmış. Sebep: ${row.ban_reason}` : 'Hesabınız askıya alınmış.');
    }
    if (row.status !== 'active') throw unauthorized('E-posta/rumuz veya parola hatalı.');

    limiters.login.reset(pairKey);
    const session = createSession(db, row.id, {
      ttlMs: config.sessionTtlMs,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    setSessionCookie(res, config, session.token, config.sessionTtlMs);
    res.json({ user: toSelfUser(getUserRow(db, row.id)) });
  });

  router.post('/logout', (req, res) => {
    if (req.sessionHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
      ctx.hub.revokeSession(req.sessionHash);
    }
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  return router;
}
