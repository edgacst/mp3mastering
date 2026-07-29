const assert = require('node:assert/strict');
const test = require('node:test');
const { createRateLimiter } = require('../lib/rateLimit');

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('rate limiter rejects requests over the per-client allowance', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
  const request = { headers: { 'x-real-ip': '203.0.113.10' }, socket: {} };
  let allowed = 0;

  const first = createResponse();
  limiter(request, first, () => {
    allowed += 1;
  });
  const second = createResponse();
  limiter(request, second, () => {
    allowed += 1;
  });
  const third = createResponse();
  limiter(request, third, () => {
    allowed += 1;
  });

  assert.equal(allowed, 2);
  assert.equal(third.statusCode, 429);
  assert.equal(third.headers['Retry-After'], '60');
  assert.match(third.body.error, /요청이 너무 많습니다/);
});
