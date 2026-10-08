import { tooMany } from './errors.js';

/** Basit sabit-pencereli, bellek içi hız sınırlayıcı. */
export class RateLimiter {
  constructor({ windowMs, max, name = 'rate' }) {
    this.windowMs = windowMs;
    this.max = max;
    this.name = name;
    this.buckets = new Map();
    this.sweeper = setInterval(() => this.sweep(), Math.min(windowMs, 60 * 1000));
    this.sweeper.unref();
  }

  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  bucket(key) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /** Bu anahtar için limit zaten dolmuş mu? (sayaç artırmaz) */
  isLimited(key) {
    const bucket = this.buckets.get(key);
    return Boolean(bucket) && bucket.resetAt > Date.now() && bucket.count >= this.max;
  }

  /** Bir deneme kaydeder. Limit içindeyse true döner. */
  hit(key) {
    const bucket = this.bucket(key);
    bucket.count += 1;
    return bucket.count <= this.max;
  }

  reset(key) {
    this.buckets.delete(key);
  }

  middleware(keyFn = (req) => req.ip) {
    return (req, res, next) => {
      if (this.hit(`${this.name}:${keyFn(req)}`)) return next();
      return next(tooMany());
    };
  }
}
