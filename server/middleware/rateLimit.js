// A very small in-memory rate limiter (no extra package needed).
// It remembers how many requests each client made recently and answers
// "429 Too Many Requests" when the limit is passed. The memory resets when
// the server restarts, which is fine for a single-server school project.

class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map(); // key -> array of timestamps (ms)
  }

  // Records one attempt. Returns { allowed, retryAfterSeconds }.
  hit(key, now = Date.now()) {
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      const retryAfterSeconds = Math.ceil((recent[0] + this.windowMs - now) / 1000);
      return { allowed: false, retryAfterSeconds };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Forget everything about a key (used after a successful login).
  reset(key) {
    this.hits.delete(key);
  }

  // Remove old keys so memory does not grow forever.
  cleanup(now = Date.now()) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

// Express middleware wrapper around a RateLimiter.
function rateLimit({ windowMs, max, message }) {
  const limiter = new RateLimiter({ windowMs, max });
  setInterval(() => limiter.cleanup(), windowMs).unref();

  const middleware = (req, res, next) => {
    const result = limiter.hit(req.ip);
    if (!result.allowed) {
      res.set('Retry-After', String(result.retryAfterSeconds));
      return res.status(429).json({ error: message });
    }
    next();
  };
  middleware.limiter = limiter;
  middleware.message = message;
  return middleware;
}

module.exports = { RateLimiter, rateLimit };
