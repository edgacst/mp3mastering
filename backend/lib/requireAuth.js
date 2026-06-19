const http = require('http');

const AUTH_BASE = (process.env.VENYSOUND_AUTH_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');

/** VenySound 세션 쿠키로 /api/auth/me 확인 */
function requireVenysoundAuth(req, res, next) {
  const cookie = req.headers.cookie;
  if (!cookie) {
    return res.status(401).json({
      error: '로그인이 필요합니다.',
      loginUrl: '/login?next=%2Fmastering%2F',
    });
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'venysound.com';

  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: Number(new URL(AUTH_BASE).port) || 5000,
      path: '/api/auth/me',
      method: 'GET',
      headers: {
        cookie,
        host: String(host).split(',')[0].trim(),
      },
    },
    (authRes) => {
      authRes.resume();
      if (authRes.statusCode === 200) return next();
      return res.status(401).json({
        error: '로그인이 필요합니다.',
        loginUrl: '/login?next=%2Fmastering%2F',
      });
    },
  );

  proxyReq.on('error', () => {
    res.status(503).json({ error: '로그인 확인 중 오류가 발생했습니다.' });
  });
  proxyReq.end();
}

module.exports = { requireVenysoundAuth };
