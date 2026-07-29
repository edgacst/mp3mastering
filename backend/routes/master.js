const express = require('express');
const path = require('path');
const fs = require('fs');
const { masterToFile, normalizeIntensity } = require('../lib/audioMastering');
const { analyzeLoudness, analyzeQuietRms } = require('../lib/audioAnalysis');
const { requireVenysoundAuth } = require('../lib/requireAuth');
const { createRateLimiter } = require('../lib/rateLimit');
const {
  cachePaths,
  readPreviewCache,
  writePreviewCache,
  removePreviewCache,
} = require('../lib/previewCache');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
const masteredDir = path.join(__dirname, '..', 'mastered');
const previewDir = path.join(__dirname, '..', 'preview');
for (const dir of [masteredDir, previewDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
const previewRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.MASTERING_PREVIEW_LIMIT) || 12,
});
const masterRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.MASTERING_DOWNLOAD_LIMIT) || 30,
});

function safeBasename(filename) {
  return path.basename(String(filename || ''));
}

function resolveInput(safeName) {
  const inputPath = path.join(uploadDir, safeName);
  if (!safeName || !fs.existsSync(inputPath)) return null;
  return inputPath;
}

function streamMp3File(
  res,
  filePath,
  { inline, displayName, safeName, deleteAfterStream = true, onClose },
) {
  const encodedName = encodeURIComponent(displayName).replace(/'/g, '%27');
  const disposition = inline ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Content-Type', 'audio/mpeg');
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('close', () => {
    if (deleteAfterStream) fs.unlink(filePath, () => {});
    if (onClose) {
      Promise.resolve(onClose()).catch((err) => {
        console.error('[master] 전송 후 임시 파일 정리 오류:', err.message);
      });
    }
  });
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: '파일 전송 중 오류가 발생했습니다.' });
  });
}

/** 업로드 직후 1곡 샘플 미리듣기 — 원본 파일은 유지 */
router.post('/preview', previewRateLimit, async (req, res) => {
  const safeName = safeBasename(req.body.filename);
  const inputPath = resolveInput(safeName);
  if (!inputPath) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }

  const displayName = req.body.originalname || safeName;
  const intensity = normalizeIntensity(req.body.intensity);
  const { audioPath: outputPath } = cachePaths(previewDir, safeName);

  try {
    const cached = await readPreviewCache({ previewDir, safeName, inputPath, intensity });
    if (cached) {
      res.setHeader('X-Preview-Stats', JSON.stringify(cached.metadata.stats));
      res.setHeader('X-Mastering-Cache', 'hit');
      streamMp3File(res, cached.audioPath, {
        inline: true,
        displayName,
        safeName,
        deleteAfterStream: false,
      });
      return;
    }

    await removePreviewCache(previewDir, safeName);
    const [originalStats, quietRms] = await Promise.all([
      analyzeLoudness(inputPath),
      intensity === 'auto' ? analyzeQuietRms(inputPath) : Promise.resolve(null),
    ]);
    const autoMeta = await masterToFile(
      inputPath,
      outputPath,
      intensity,
      intensity === 'auto' ? { loudness: originalStats, quietRms } : null,
    );
    const masteredStats = await analyzeLoudness(outputPath);
    const stats = { original: originalStats, mastered: masteredStats, auto: autoMeta };
    let cacheSaved = false;
    try {
      await writePreviewCache({
        previewDir,
        safeName,
        inputPath,
        intensity,
        stats,
      });
      cacheSaved = true;
    } catch (cacheErr) {
      console.error('[preview-cache] 저장 오류:', cacheErr.message);
    }
    res.setHeader(
      'X-Preview-Stats',
      JSON.stringify(stats),
    );
    res.setHeader('X-Mastering-Cache', 'miss');
    streamMp3File(res, outputPath, {
      inline: true,
      displayName,
      safeName,
      deleteAfterStream: !cacheSaved,
    });
  } catch (err) {
    console.error('ffmpeg preview 오류:', err.message);
    await removePreviewCache(previewDir, safeName).catch(() => {});
    if (!res.headersSent) {
      res.status(500).json({ error: '미리듣기 마스터링 중 오류: ' + err.message });
    }
  }
});

/** 전체 다운로드용 — 로그인 필요, 처리 후 원본·결과 임시 파일 삭제 */
router.post('/', requireVenysoundAuth, masterRateLimit, async (req, res) => {
  const safeName = safeBasename(req.body.filename);
  const inputPath = resolveInput(safeName);
  if (!inputPath) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }

  const displayName = req.body.originalname || safeName;
  const intensity = normalizeIntensity(req.body.intensity);
  const outputPath = path.join(masteredDir, 'mastered_' + safeName);

  try {
    const cached = await readPreviewCache({ previewDir, safeName, inputPath, intensity });
    if (cached) {
      res.setHeader('X-Mastering-Cache', 'hit');
      streamMp3File(res, cached.audioPath, {
        inline: false,
        displayName,
        safeName,
        deleteAfterStream: false,
        onClose: async () => {
          await Promise.all([
            removePreviewCache(previewDir, safeName),
            fs.promises.rm(inputPath, { force: true }),
          ]);
        },
      });
      return;
    }

    await masterToFile(inputPath, outputPath, intensity);
    res.setHeader('X-Mastering-Cache', 'miss');
    streamMp3File(res, outputPath, {
      inline: false,
      displayName,
      safeName,
      onClose: () => fs.promises.rm(inputPath, { force: true }),
    });
  } catch (err) {
    console.error('ffmpeg 오류:', err.message);
    fs.unlink(outputPath, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: '마스터링 처리 중 오류가 발생했습니다: ' + err.message });
    }
  }
});

module.exports = router;
