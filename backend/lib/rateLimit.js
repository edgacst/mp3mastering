function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clientAddress(req) {
  const realIp = String(req.headers?.['x-real-ip'] || '').trim();
  if (realIp) return realIp;

  const forwarded = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (forwarded) return forwarded;

  return req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter({
  windowMs,
  max,
  message = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
}) {
  const safeWindowMs = positiveInteger(windowMs, 10 * 60 * 1000);
  const safeMax = positiveInteger(max, 30);
  const clients = new Map();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of clients) {
      if (record.resetAt <= now) clients.delete(key);
    }
  }, safeWindowMs);
  cleanupTimer.unref?.();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = clientAddress(req);
    let record = clients.get(key);

    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + safeWindowMs };
      clients.set(key, record);
    }

    record.count += 1;
    const remaining = Math.max(0, safeMax - record.count);
    res.setHeader('X-RateLimit-Limit', String(safeMax));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (record.count > safeMax) {
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
