const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { analyzeLoudness } = require('../lib/audioAnalysis');
const { masterToFile } = require('../lib/audioMastering');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-500) || `${command} exited with ${code}`));
    });
  });
}

test('auto mastering applies the reported target LUFS', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mp3mastering-audio-'));
  const inputPath = path.join(directory, 'input.mp3');
  const outputPath = path.join(directory, 'output.mp3');

  try {
    await run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=12',
      '-af',
      'volume=0.05',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      inputPath,
    ]);

    const before = await analyzeLoudness(inputPath);
    const metadata = await masterToFile(inputPath, outputPath, 'auto');
    const after = await analyzeLoudness(outputPath);

    assert.ok(Number.isFinite(before.lufs));
    assert.ok(Number.isFinite(metadata.targetLufs));
    assert.ok(Number.isFinite(after.lufs));
    assert.ok(
      Math.abs(after.lufs - metadata.targetLufs) <= 1,
      `output ${after.lufs} LUFS did not match target ${metadata.targetLufs} LUFS`,
    );
    assert.ok(after.truePeak <= -0.5, `true peak ${after.truePeak} dBTP exceeded the safe ceiling`);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
