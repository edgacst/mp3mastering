const ffmpeg = require('fluent-ffmpeg');

const AUDIO_FILTERS = [
  'dynaudnorm=p=0.9:m=100:s=12',
  'acompressor=threshold=0.25:ratio=3:attack=100:release=500:makeup=2',
  'equalizer=f=80:t=o:w=1:g=3',
  'equalizer=f=400:t=o:w=1:g=-1.5',
  'equalizer=f=8000:t=o:w=2:g=2',
  'alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=50',
];

/** inputPath → outputPath MP3 마스터링 (다운로드·미리듣기 공통) */
function masterToFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(AUDIO_FILTERS)
      .audioCodec('libmp3lame')
      .audioBitrate('320k')
      .on('stderr', (line) => console.log('[ffmpeg]', line))
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });
}

module.exports = { masterToFile };
