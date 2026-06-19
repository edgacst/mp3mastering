const { analyzeLoudness, analyzeQuietRms } = require('./audioAnalysis');

/** 검증된 기본 체인 (highpass·loudnorm·-map 없음 — ffmpeg 222 방지) */
const SAFE_CHAIN = [
  'dynaudnorm=p=0.72:m=100:s=5',
  'acompressor=threshold=0.38:ratio=2:attack=120:release=650:makeup=1',
  'equalizer=f=80:t=o:w=1:g=1',
  'equalizer=f=400:t=o:w=1:g=-0.5',
  'equalizer=f=8000:t=o:w=2:g=0.5',
  'alimiter=level_in=1:level_out=1:limit=0.85:attack=5:release=50',
];

const PRESETS = {
  light: [...SAFE_CHAIN],
  medium: [
    'dynaudnorm=p=0.82:m=100:s=8',
    'acompressor=threshold=0.3:ratio=2.5:attack=100:release=550:makeup=1',
    'equalizer=f=80:t=o:w=1:g=1.5',
    'equalizer=f=400:t=o:w=1:g=-1',
    'equalizer=f=8000:t=o:w=2:g=1',
    'alimiter=level_in=1:level_out=1:limit=0.87:attack=5:release=50',
  ],
  strong: [
    'dynaudnorm=p=0.9:m=100:s=12',
    'acompressor=threshold=0.25:ratio=3:attack=100:release=500:makeup=2',
    'equalizer=f=80:t=o:w=1:g=3',
    'equalizer=f=400:t=o:w=1:g=-1.5',
    'equalizer=f=8000:t=o:w=2:g=2',
    'alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=50',
  ],
};

const MINIMAL_CHAIN = [
  'dynaudnorm=p=0.72:m=100:s=5',
  'alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=50',
];

const MANUAL_INTENSITIES = new Set(Object.keys(PRESETS));

/** 원본 LUFS·조용 구간 분석 → SAFE_CHAIN 기반 미세 조정 */
function buildAutoFilters({ lufs, truePeak, quietRms }) {
  const inputLufs = Number.isFinite(lufs) ? lufs : -14;
  const quiet = Number.isFinite(quietRms) ? quietRms : -92;

  let boost = 0.55;
  if (inputLufs >= -11.5) boost = 0.2;
  else if (inputLufs >= -13) boost = 0.4;
  const targetLufs = Math.min(inputLufs + boost, -10.8);

  const maxGain = quiet < -88 ? 5 : 7;
  const normP = inputLufs >= -11.5 ? 0.68 : 0.72;
  const highShelf = Number.isFinite(truePeak) && truePeak > -2 ? 0.3 : 0.5;

  const filters = [
    `dynaudnorm=p=${normP}:m=100:s=${maxGain}`,
    'acompressor=threshold=0.38:ratio=2:attack=120:release=650:makeup=1',
    'equalizer=f=80:t=o:w=1:g=1',
    'equalizer=f=400:t=o:w=1:g=-0.5',
    `equalizer=f=8000:t=o:w=2:g=${highShelf}`,
    'alimiter=level_in=1:level_out=1:limit=0.85:attack=5:release=50',
  ];

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
  let autoMeta = null;
  const chains = [];

  if (level === 'auto') {
    const loudness = await analyzeLoudness(inputPath);
    const quietRms = await analyzeQuietRms(inputPath);
    const built = buildAutoFilters({ lufs: loudness.lufs, truePeak: loudness.truePeak, quietRms });
    autoMeta = {
      mode: 'auto',
      inputLufs: loudness.lufs,
      targetLufs: built.targetLufs,
      quietRms,
    };
    chains.push(built.filters);
    console.log('[auto-master]', autoMeta, 'filters:', built.filters.join(','));
  } else {
    chains.push(PRESETS[level]);
  }

  chains.push(SAFE_CHAIN, MINIMAL_CHAIN);

  let lastErr;
  for (let i = 0; i < chains.length; i += 1) {
    const chain = chains[i];
    try {
      await runFfmpegEncode(inputPath, outputPath, chain);
      if (i > 0 && autoMeta) autoMeta.fallback = i === 1 ? 'safe' : 'minimal';
      return autoMeta;
    } catch (err) {
      lastErr = err;
      console.error(`[master] chain ${i + 1}/${chains.length} failed:`, err.message, chain.join(','));
    }
  }

  throw lastErr;
}

module.exports = { masterToFile, normalizeIntensity, buildAutoFilters, PRESETS };
