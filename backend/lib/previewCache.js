const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 1;

function cachePaths(previewDir, safeName) {
  const filename = String(safeName || '');
  if (!filename || path.basename(filename) !== filename) {
    throw new Error('올바르지 않은 캐시 파일명입니다.');
  }

  const audioPath = path.join(previewDir, `preview_${filename}`);
  return {
    audioPath,
    metadataPath: `${audioPath}.json`,
  };
}

async function readPreviewCache({ previewDir, safeName, inputPath, intensity }) {
  let paths;
  try {
    paths = cachePaths(previewDir, safeName);
    const [metadataText, inputStat, audioStat] = await Promise.all([
      fs.promises.readFile(paths.metadataPath, 'utf8'),
      fs.promises.stat(inputPath),
      fs.promises.stat(paths.audioPath),
    ]);
    const metadata = JSON.parse(metadataText);

    if (
      metadata.version !== CACHE_VERSION ||
      metadata.sourceFilename !== safeName ||
      metadata.intensity !== intensity ||
      metadata.sourceSize !== inputStat.size ||
      metadata.sourceMtimeMs !== inputStat.mtimeMs ||
      metadata.audioSize !== audioStat.size ||
      !metadata.stats
    ) {
      return null;
    }

    return { ...paths, metadata };
  } catch {
    return null;
  }
}

async function writePreviewCache({
  previewDir,
  safeName,
  inputPath,
  intensity,
  stats,
}) {
  const paths = cachePaths(previewDir, safeName);
  const [inputStat, audioStat] = await Promise.all([
    fs.promises.stat(inputPath),
    fs.promises.stat(paths.audioPath),
  ]);
  const metadata = {
    version: CACHE_VERSION,
    sourceFilename: safeName,
    sourceSize: inputStat.size,
    sourceMtimeMs: inputStat.mtimeMs,
    intensity,
    audioSize: audioStat.size,
    createdAt: Date.now(),
    stats,
  };
  const temporaryPath = `${paths.metadataPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(metadata), 'utf8');
    await fs.promises.rm(paths.metadataPath, { force: true });
    await fs.promises.rename(temporaryPath, paths.metadataPath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }

  return { ...paths, metadata };
}

async function removePreviewCache(previewDir, safeName) {
  const paths = cachePaths(previewDir, safeName);
  await Promise.all([
    fs.promises.rm(paths.audioPath, { force: true }),
    fs.promises.rm(paths.metadataPath, { force: true }),
  ]);
}

module.exports = {
  cachePaths,
  readPreviewCache,
  writePreviewCache,
  removePreviewCache,
};
