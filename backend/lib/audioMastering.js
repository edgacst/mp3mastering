const { analyzeLoudness, analyzeQuietRms } = require('./audioAnalysis');

/** 수동 프리셋 (API 호환) — loudnorm 미사용(단일 패스 충돌 방지) */
const PRESETS = {
  light: [
    'highpass=f=35',
    'dynaudnorm=p=0.72:m=100:s=5',
    'acompressor=threshold=0.38:ratio=2:attack=120:release=650:makeup=0.8',
    'equalizer=f=80:t=o:w=1:g=0.9',
    'equalizer=f=400:t=o:w=1:g=-0.5',
    'equalizer=f=8000:t=o:w=2:g=0.4',
    'alimiter=level_in=1:level_out=1:limit=0.84:attack=5:release=80',
  ],
  medium: [
    'highpass=f=35',
    'dynaudnorm=p=0.82:m=100:s=8',
    'acompressor=threshold=0.3:ratio=2.5:attack=100:release=550:makeup=1.2',
    'equalizer=f=80:t=o:w=1:g=1.5',
    'equalizer=f=400:t=o:w=1:g=-0.8',
    'equalizer=f=8000:t=o:w=2:g=1',
    'alimiter=level_in=1:level_out=1:limit=0.87:attack=5:release=50',
  ],
  strong: [
    'highpass=f=35',
    'dynaudnorm=p=0.9:m=100:s=12',
    'acompressor=threshold=0.25:ratio=3:attack=100:release=500:makeup=2',
    'equalizer=f=80:t=o:w=1:g=3',
    'equalizer=f=400:t=o:w=1:g=-1.5',
    'equalizer=f=8000:t=o:w=2:g=2',
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

  let boost = 0.55;
  if (inputLufs >= -11.5) boost = 0.2;
  else if (inputLufs >= -13) boost = 0.4;
  const targetLufs = Math.min(inputLufs + boost, -10.8);

  // dynaudnorm: p 낮을수록 덜 키움 · s 낮을수록 조용 구간 노이즈 덜 끌어올림
  const normPeak = inputLufs >= -11.5 ? 0.58 : inputLufs >= -13 ? 0.64 : 0.68;
  const maxGain = quiet < -88 ? 4 : quiet < -85 ? 5 : 6;

  if (inputLufs < -11) {
    filters.push(`dynaudnorm=p=${normPeak}:m=100:s=${maxGain}`);
  }

  if (inputLufs < -12.5) {
    filters.push('equalizer=f=80:t=o:w=1:g=0.6');
    filters.push('equalizer=f=400:t=o:w=1:g=-0.35');
    if (inputTp < -2) {
      filters.push('equalizer=f=8000:t=o:w=2:g=0.3');
    }
    const makeup = inputLufs < -14 ? 0.45 : 0.35;
    filters.push(`acompressor=threshold=0.44:ratio=2:attack=140:release=750:makeup=${makeup}`);
  } else {
    filters.push('equalizer=f=400:t=o:w=1:g=-0.15');
  }

  const limitOut = inputTp > -1.5 ? 0.79 : 0.84;
  filters.push(`alimiter=level_in=1:level_out=1:limit=${limitOut}:attack=5:release=80`);

  return { filters, targetLufs, boost };
}

function normalizeIntensity(value) {
  const key = String(value || 'auto').toLowerCase();
  if (key === 'auto') return 'auto';
  return MANUAL_INTENSITIES.has(key) ? key : 'auto';
}

function runFfmpegEncode(inputPath, outputPath, audioFilters) {
  const ffmpeg = require('fluent-ffmpeg');
  const chain = audioFilters.join(',');

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions('-map', '0:a:0')
      .audioFilters(audioFilters)
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('stderr', (line) => console.log('[ffmpeg]', line))
      .on('error', (err) => {
        err.filterChain = chain;
        reject(err);
      })
      .on('end', () => resolve())
      .save(outputPath);
  });
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
    console.log('[auto-master]', autoMeta, 'filters:', audioFilters.join(','));
  } else {
    audioFilters = PRESETS[level];
  }

  try {
    await runFfmpegEncode(inputPath, outputPath, audioFilters);
    return autoMeta;
  } catch (err) {
    if (level !== 'auto') throw err;
    console.error('[auto-master] fallback to light:', err.message, err.filterChain);
    await runFfmpegEncode(inputPath, outputPath, PRESETS.light);
    return { ...autoMeta, fallback: 'light' };
  }
}

module.exports = { masterToFile, normalizeIntensity, buildAutoFilters, PRESETS };
