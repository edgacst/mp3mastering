const express = require('express');
const path = require('path');
const fs = require('fs');
const { masterToFile } = require('../lib/audioMastering');
const { analyzeLoudness } = require('../lib/audioAnalysis');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
const masteredDir = path.join(__dirname, '..', 'mastered');
const previewDir = path.join(__dirname, '..', 'preview');
for (const dir of [masteredDir, previewDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeBasename(filename) {
  return path.basename(String(filename || ''));
}

function resolveInput(safeName) {
  const inputPath = path.join(uploadDir, safeName);
  if (!safeName || !fs.existsSync(inputPath)) return null;
  return inputPath;
}

function streamMp3File(res, filePath, { inline, displayName, safeName }) {
  const encodedName = encodeURIComponent(displayName).replace(/'/g, '%27');
  const disposition = inline ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Content-Type', 'audio/mpeg');
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('close', () => {
    fs.unlink(filePath, () => {});
  });
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: '파일 전송 중 오류가 발생했습니다.' });
  });
}

/** 업로드 직후 1곡 샘플 미리듣기 — 원본 파일은 유지 */
router.post('/preview', async (req, res) => {
  const safeName = safeBasename(req.body.filename);
  const inputPath = resolveInput(safeName);
  if (!inputPath) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }

  const displayName = req.body.originalname || safeName;
  const outputPath = path.join(previewDir, `preview_${safeName}`);

  try {
    const originalStats = await analyzeLoudness(inputPath);
    await masterToFile(inputPath, outputPath);
    const masteredStats = await analyzeLoudness(outputPath);
    res.setHeader(
      'X-Preview-Stats',
      JSON.stringify({ original: originalStats, mastered: masteredStats }),
    );
    streamMp3File(res, outputPath, { inline: true, displayName, safeName });
  } catch (err) {
    console.error('ffmpeg preview 오류:', err.message);
    fs.unlink(outputPath, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: '미리듣기 마스터링 중 오류: ' + err.message });
    }
  }
});

/** 전체 다운로드용 — 처리 후 원본·결과 임시 파일 삭제 */
router.post('/', async (req, res) => {
  const safeName = safeBasename(req.body.filename);
  const inputPath = resolveInput(safeName);
  if (!inputPath) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }

  const displayName = req.body.originalname || safeName;
  const outputPath = path.join(masteredDir, 'mastered_' + safeName);

  try {
    await masterToFile(inputPath, outputPath);
    streamMp3File(res, outputPath, { inline: false, displayName, safeName });
    fs.unlink(inputPath, () => {});
  } catch (err) {
    console.error('ffmpeg 오류:', err.message);
    fs.unlink(outputPath, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: '마스터링 처리 중 오류가 발생했습니다: ' + err.message });
    }
  }
});

module.exports = router;
