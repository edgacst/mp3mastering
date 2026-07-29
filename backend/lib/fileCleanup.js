const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function cleanupStaleFiles(
  directories,
  { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {},
) {
  const result = { scanned: 0, deleted: 0, errors: [] };

  for (const directory of directories) {
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') result.errors.push({ path: directory, error: err.message });
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(directory, entry.name);
      result.scanned += 1;

      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs < maxAgeMs) continue;
        await fs.promises.unlink(filePath);
        result.deleted += 1;
      } catch (err) {
        if (err.code !== 'ENOENT') result.errors.push({ path: filePath, error: err.message });
      }
    }
  }

  return result;
}

function startFileCleanup(
  directories,
  {
    maxAgeMs = positiveNumber(process.env.MASTERING_FILE_TTL_MS, DEFAULT_MAX_AGE_MS),
    intervalMs = positiveNumber(process.env.MASTERING_CLEANUP_INTERVAL_MS, DEFAULT_INTERVAL_MS),
  } = {},
) {
  const run = async () => {
    const result = await cleanupStaleFiles(directories, { maxAgeMs });
    if (result.deleted > 0) {
      console.log(`[cleanup] 오래된 임시 파일 ${result.deleted}개 삭제`);
    }
    for (const item of result.errors) {
      console.error(`[cleanup] ${item.path}: ${item.error}`);
    }
    return result;
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();

  return {
    run,
    stop: () => clearInterval(timer),
  };
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  cleanupStaleFiles,
  startFileCleanup,
};
