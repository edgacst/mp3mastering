const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  cachePaths,
  readPreviewCache,
  writePreviewCache,
  removePreviewCache,
} = require('../lib/previewCache');

test('preview cache is reused only for the unchanged source and intensity', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mp3mastering-preview-cache-'));
  const previewDir = path.join(directory, 'preview');
  const inputPath = path.join(directory, 'source.mp3');
  const safeName = '123-456.mp3';
  const paths = cachePaths(previewDir, safeName);

  try {
    await fs.promises.mkdir(previewDir);
    await fs.promises.writeFile(inputPath, 'source');
    await fs.promises.writeFile(paths.audioPath, 'mastered');
    const stats = {
      original: { lufs: -14 },
      mastered: { lufs: -13.5 },
      auto: { targetLufs: -13.45 },
    };

    await writePreviewCache({
      previewDir,
      safeName,
      inputPath,
      intensity: 'auto',
      stats,
    });

    const cached = await readPreviewCache({
      previewDir,
      safeName,
      inputPath,
      intensity: 'auto',
    });
    assert.deepEqual(cached.metadata.stats, stats);

    const wrongIntensity = await readPreviewCache({
      previewDir,
      safeName,
      inputPath,
      intensity: 'strong',
    });
    assert.equal(wrongIntensity, null);

    await fs.promises.appendFile(inputPath, '-changed');
    const changedSource = await readPreviewCache({
      previewDir,
      safeName,
      inputPath,
      intensity: 'auto',
    });
    assert.equal(changedSource, null);

    await removePreviewCache(previewDir, safeName);
    assert.equal(fs.existsSync(paths.audioPath), false);
    assert.equal(fs.existsSync(paths.metadataPath), false);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
