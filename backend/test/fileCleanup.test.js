const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { cleanupStaleFiles } = require('../lib/fileCleanup');

test('cleanup removes only files older than the configured lifetime', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mp3mastering-cleanup-'));
  const oldFile = path.join(directory, 'old.mp3');
  const recentFile = path.join(directory, 'recent.mp3');
  const now = Date.now();

  try {
    await fs.promises.writeFile(oldFile, 'old');
    await fs.promises.writeFile(recentFile, 'recent');
    const oldTime = new Date(now - 25 * 60 * 60 * 1000);
    await fs.promises.utimes(oldFile, oldTime, oldTime);

    const result = await cleanupStaleFiles([directory], {
      now,
      maxAgeMs: 24 * 60 * 60 * 1000,
    });

    assert.equal(result.deleted, 1);
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.existsSync(recentFile), true);
    assert.deepEqual(result.errors, []);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
