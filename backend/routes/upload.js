const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 브라우저/OS마다 MIME 타입이 다양함 (audio/mp3, audio/x-mpeg 등)
const allowedMime = ['audio/mpeg', 'audio/mp3', 'audio/x-mpeg', 'audio/x-mp3', 'application/octet-stream'];

function fixEncoding(name) {
  // 이미 한글이 정상인 경우는 그대로 두고, 깨진 경우만 보정
  if (/[\u3131-\uD79D]/.test(name)) return name;

  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (/[\u3131-\uD79D]/.test(fixed)) return fixed;
    return name;
  } catch (_) {
    return name;
  }
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    file.originalname = fixEncoding(file.originalname);
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '.mp3');
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    file.originalname = fixEncoding(file.originalname);
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMime.includes(file.mimetype) || ext === '.mp3') {
      cb(null, true);
    } else {
      cb(new Error('MP3 파일만 업로드 가능합니다.'));
    }
  }
});

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  res.json({
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size
  });
});

router.use((err, req, res, next) => {
  res.status(400).json({ error: err.message });
});

module.exports = router;
