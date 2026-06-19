// server.js (Express backend)
const express = require('express');
const path = require('path');
const uploadRouter = require('./routes/upload');
const masterRouter = require('./routes/master');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '2mb' }));

// 정적 파일 제공 (프론트엔드 빌드 결과) – 개발 시 Vite dev server 사용, prod 시 dist 폴더
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist'), { redirect: false }));

// API 라우트
app.use('/api/upload', uploadRouter);
app.use('/api/master', masterRouter);

// 모든 다른 경로는 index.html 로 fallback (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

function isAbortedRequestError(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  return err.code === 'ECONNABORTED' || err.type === 'request.aborted' || /request aborted/i.test(msg);
}

app.use((err, req, res, next) => {
  if (isAbortedRequestError(err)) {
    if (!res.headersSent) {
      return res.status(499).json({ error: '업로드가 중단되었습니다. 네트워크를 확인하고 다시 시도해 주세요.' });
    }
    return;
  }
  console.error('[mastering]', err.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || '서버 오류' });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Backend running on http://${HOST}:${PORT}`);
});

// ffmpeg 마스터링·대용량 업로드 — nginx proxy_read_timeout(600s)과 맞춤
server.timeout = 600_000;
server.keepAliveTimeout = 650_000;
server.headersTimeout = 660_000;
