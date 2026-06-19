const { analyzeLoudness, analyzeQuietRms } = require('./audioAnalysis');

/** light=기본(부드러움) · medium · strong=이전 기본 수준 */
const PRESETS = {
  light: [
    'highpass=f=35',
    'dynaudnorm=p=0.72:m=100:s=5',
    'acompressor=threshold=0.38:ratio=2:attack=120:release=650:makeup=0.8',
    'equalizer=f=80:t=o:w=1:g=0.9',
    'equalizer=f=400:t=o:w=1:g=-0.5',
    'equalizer=f=8000:t=o:w=2:g=0.4',
    'loudnorm=I=-13:TP=-1.5:LRA=11',
    'alimiter=level_in=1:level_out=1:limit=0.84:attack=5:release=80',
  ],
  medium: [
    'highpass=f=35',
    'dynaudnorm=p=0.82:m=100:s=8',
    'acompressor=threshold=0.3:ratio=2.5:attack=100:release=550:makeup=1.2',
    'equalizer=f=80:t=o:w=1:g=1.5',
    'equalizer=f=400:t=o:w=1:g=-0.8',
    'equalizer=f=8000:t=o:w=2:g=1',
    'loudnorm=I=-12:TP=-1.5:LRA=11',
    'alimiter=level_in=1:level_out=1:limit=0.87:attack=5:release=50',
  ],
  strong: [
    'highpass=f=35',
    'dynaudnorm=p=0.9:m=100:s=12',
    'acompressor=threshold=0.25:ratio=3:attack=100:release=500:makeup=2',
    'equalizer=f=80:t=o:w=1:g=3',
    'equalizer=f=400:t=o:w=1:g=-1.5',
    'equalizer=f=8000:t=o:w=2:g=2',
    'loudnorm=I=-11:TP=-1.2:LRA=11',
    'alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=50',
  ],
};

const MANUAL_INTENSITIES = new Set(Object.keys(PRESETS));

/** 원본 LUFS·노이즈 바닥·피크를 보고 체인 자동 구성 */
function buildAutoFilters({ lufs, truePeak, quietRms }) {
  const inputLufs = Number.isFinite(lufs) ? lufs : -14;
  const inputTp = Number.isFinite(truePeak) ? truePeak : -2;
  const quiet = Number.isFinite(quietRms) ? quietRms : -92;

  const filters = ['highpass=f=35'];

  // 조용한 인트로·MP3 hiss — 아주 약한 노이즈 감소
  if (quiet > -93) {
    filters.push('afftdn=nr=6:nf=-32');
  }

  if (inputLufs < -12.5) {
    filters.push('equalizer=f=80:t=o:w=1:g=0.7');
    filters.push('equalizer=f=400:t=o:w=1:g=-0.35');
    if (inputTp < -2) {
      filters.push('equalizer=f=8000:t=o:w=2:g=0.35');
    }
    filters.push('acompressor=threshold=0.44:ratio=2:attack=140:release=750:makeup=0.5');
  } else {
    filters.push('equalizer=f=400:t=o:w=1:g=-0.2');
  }

  // 원본 대비 LUFS 상승 제한 (이미 큰 곡은 거의 그대로)
  let boost = 0.55;
  if (inputLufs >= -11.5) boost = 0.2;
  else if (inputLufs >= -13) boost = 0.4;
  const targetLufs = Math.min(inputLufs + boost, -10.8);

  filters.push(`loudnorm=I=${targetLufs.toFixed(1)}:TP=-1.5:LRA=11`);
  filters.push('alimiter=level_in=1:level_out=1:limit=0.84:attack=5:release=80');

  return { filters, targetLufs, boost };
}

function normalizeIntensity(value) {
  const key = String(value || 'auto').toLowerCase();
  if (key === 'auto') return 'auto';
  return MANUAL_INTENSITIES.has(key) ? key : 'auto';
}

/** inputPath → outputPath MP3 마스터링 (auto=원본 분석 후 자동) */
async function masterToFile(inputPath, outputPath, intensity = 'auto') {
  const level = normalizeIntensity(intensity);
  let audioFilters;
  let autoMeta = null;

  if (level === 'auto') {
    const loudness = await analyzeLoudness(inputPath);
    const quietRms = await analyzeQuietRms(inputPath);
    const built = buildAutoFilters({ lufs: loudness.lufs, truePeak: loudness.truePeak, quietRms });
    audioFilters = built.filters;
    autoMeta = {
      mode: 'auto',
      inputLufs: loudness.lufs,
      targetLufs: built.targetLufs,
      quietRms,
    };
    console.log('[auto-master]', autoMeta);
  } else {
    audioFilters = PRESETS[level];
  }

  return new Promise((resolve, reject) => {
    const ffmpeg = require('fluent-ffmpeg');
    ffmpeg(inputPath)
      .outputOptions('-map', '0:a:0')
      .audioFilters(audioFilters)
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('stderr', (line) => console.log('[ffmpeg]', line))
      .on('error', reject)
      .on('end', () => resolve(autoMeta))
      .save(outputPath);
  });
}

module.exports = { masterToFile, normalizeIntensity, buildAutoFilters, PRESETS };
