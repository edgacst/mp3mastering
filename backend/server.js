// server.js (Express backend)
const express = require('express');
const path = require('path');
const uploadRouter = require('./routes/upload');
const masterRouter = require('./routes/master');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// 정적 파일 제공 (프론트엔드 빌드 결과) – 개발 시 Vite dev server 사용, prod 시 dist 폴더
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

// API 라우트
app.use('/api/upload', uploadRouter);
app.use('/api/master', masterRouter);

// 모든 다른 경로는 index.html 로 fallback (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
