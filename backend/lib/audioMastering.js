const ffmpeg = require('fluent-ffmpeg');

/** light=기본(부드러움) · medium · strong=이전 기본 수준 */
const PRESETS = {
  light: [
    'dynaudnorm=p=0.72:m=100:s=7',
    'acompressor=threshold=0.38:ratio=2:attack=120:release=650:makeup=1',
    'equalizer=f=80:t=o:w=1:g=1.2',
    'equalizer=f=400:t=o:w=1:g=-0.6',
    'equalizer=f=8000:t=o:w=2:g=0.8',
    'alimiter=level_in=1:level_out=1:limit=0.85:attack=5:release=50',
  ],
  medium: [
    'dynaudnorm=p=0.82:m=100:s=10',
    'acompressor=threshold=0.3:ratio=2.5:attack=100:release=550:makeup=1.5',
    'equalizer=f=80:t=o:w=1:g=2',
    'equalizer=f=400:t=o:w=1:g=-1',
    'equalizer=f=8000:t=o:w=2:g=1.5',
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

const VALID_INTENSITIES = new Set(Object.keys(PRESETS));

function normalizeIntensity(value) {
  const key = String(value || 'light').toLowerCase();
  return VALID_INTENSITIES.has(key) ? key : 'light';
}

/** inputPath → outputPath MP3 마스터링 (다운로드·미리듣기 공통) */
function masterToFile(inputPath, outputPath, intensity = 'light') {
  const level = normalizeIntensity(intensity);
  const audioFilters = PRESETS[level];

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(audioFilters)
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('stderr', (line) => console.log('[ffmpeg]', line))
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });
}

module.exports = { masterToFile, normalizeIntensity, PRESETS };
