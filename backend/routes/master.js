const express = require('express');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
const masteredDir = path.join(__dirname, '..', 'mastered');
if (!fs.existsSync(masteredDir)) fs.mkdirSync(masteredDir, { recursive: true });

router.post('/', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename이 필요합니다.' });

  // path traversal 방지: basename만 허용
  const safeName = path.basename(filename);
  const inputPath = path.join(uploadDir, safeName);
  const outputPath = path.join(masteredDir, 'mastered_' + safeName);

  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  }

    // req.body.originalname이 있으면 다운로드 파일명에 사용 (한글 RFC 5987 인코딩)
    const displayName = req.body.originalname
      ? req.body.originalname
      : safeName;
    const encodedName = encodeURIComponent(displayName).replace(/'/g, "%27");

  ffmpeg(inputPath)
    .audioFilters([
      // 1단계: 다이나믹 노멀라이제이션 (단일 패스, 안정적)
      'dynaudnorm=p=0.9:m=100:s=12',
      // 2단계: 컴프레서 (다이나믹 레인지 조절, threshold는 선형 0~1)
      'acompressor=threshold=0.25:ratio=3:attack=100:release=500:makeup=2',
      // 3단계: EQ – 옥타브 단위 대역폭(w)을 올바르게 설정
      'equalizer=f=80:t=o:w=1:g=3',      // 80Hz 저역 +3dB, 1옥타브 폭
      'equalizer=f=400:t=o:w=1:g=-1.5',  // 400Hz 탁한 중역 -1.5dB
      'equalizer=f=8000:t=o:w=2:g=2',    // 8kHz 고역 밝게 +2dB
      // 4단계: 리미터 (클리핑 방지, 트루피크 -1dBTP)
      'alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=50'
    ])
    .audioCodec('libmp3lame')
    .audioBitrate('320k')
    .on('stderr', (line) => console.log('[ffmpeg]', line))
    .on('error', (err) => {
      console.error('ffmpeg 오류:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: '마스터링 처리 중 오류가 발생했습니다: ' + err.message });
      }
    })
    .on('end', () => {
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
      res.setHeader('Content-Type', 'audio/mpeg');
      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);
      stream.on('close', () => {
        fs.unlink(outputPath, () => {});
        fs.unlink(inputPath, () => {});
      });
    })
    .save(outputPath);
});

module.exports = router;
