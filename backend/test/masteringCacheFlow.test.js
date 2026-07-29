const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { cachePaths } = require('../lib/previewCache');

const backendDir = path.join(__dirname, '..');
const uploadDir = path.join(backendDir, 'uploads');
const previewDir = path.join(backendDir, 'preview');
const masteredDir = path.join(backendDir, 'mastered');

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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function unusedPort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForBackend(baseUrl, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`backend exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/upload/original/not-found.mp3`);
      if (response.status === 404) return;
    } catch {
      // 서버가 포트를 열 때까지 짧게 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('backend did not become ready');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('preview output is reused for the authenticated final download', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mp3mastering-cache-flow-'));
  const sourcePath = path.join(tempDir, 'source.mp3');
  const authServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const authPort = await listen(authServer);
  const appPort = await unusedPort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const backend = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(appPort),
      VENYSOUND_AUTH_URL: `http://127.0.0.1:${authPort}`,
    },
    stdio: 'ignore',
  });
  let uploadedName = null;

  try {
    await waitForBackend(baseUrl, backend);
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
      sourcePath,
    ]);

    const form = new FormData();
    form.append('displayName', 'cache-flow.mp3');
    form.append('file', new Blob([await fs.promises.readFile(sourcePath)], { type: 'audio/mpeg' }), 'cache-flow.mp3');
    const uploadResponse = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: form });
    assert.equal(uploadResponse.status, 200);
    uploadedName = (await uploadResponse.json()).filename;
    assert.equal(path.basename(uploadedName), uploadedName);

    const previewStarted = performance.now();
    const previewResponse = await fetch(`${baseUrl}/api/master/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: uploadedName,
        originalname: 'cache-flow.mp3',
        intensity: 'auto',
      }),
    });
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers.get('x-mastering-cache'), 'miss');
    const previewBuffer = Buffer.from(await previewResponse.arrayBuffer());
    const previewMs = performance.now() - previewStarted;

    const finalStarted = performance.now();
    const finalResponse = await fetch(`${baseUrl}/api/master`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'session=cache-flow-test',
      },
      body: JSON.stringify({
        filename: uploadedName,
        originalname: 'cache-flow.mp3',
        intensity: 'auto',
      }),
    });
    assert.equal(finalResponse.status, 200);
    assert.equal(finalResponse.headers.get('x-mastering-cache'), 'hit');
    const finalBuffer = Buffer.from(await finalResponse.arrayBuffer());
    const finalMs = performance.now() - finalStarted;

    assert.equal(sha256(finalBuffer), sha256(previewBuffer));
    assert.ok(finalMs < previewMs, `cached ${finalMs.toFixed(0)}ms was not faster than preview ${previewMs.toFixed(0)}ms`);
    console.log(`[cache-flow] preview=${previewMs.toFixed(0)}ms cached-download=${finalMs.toFixed(0)}ms`);

    const cachedPaths = cachePaths(previewDir, uploadedName);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const filesRemain =
        fs.existsSync(path.join(uploadDir, uploadedName)) ||
        fs.existsSync(cachedPaths.audioPath) ||
        fs.existsSync(cachedPaths.metadataPath);
      if (!filesRemain) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(fs.existsSync(path.join(uploadDir, uploadedName)), false);
    assert.equal(fs.existsSync(cachedPaths.audioPath), false);
    assert.equal(fs.existsSync(cachedPaths.metadataPath), false);
  } finally {
    backend.kill();
    await new Promise((resolve) => authServer.close(resolve));
    if (uploadedName && path.basename(uploadedName) === uploadedName) {
      const cachedPaths = cachePaths(previewDir, uploadedName);
      await Promise.all([
        fs.promises.rm(path.join(uploadDir, uploadedName), { force: true }),
        fs.promises.rm(cachedPaths.audioPath, { force: true }),
        fs.promises.rm(cachedPaths.metadataPath, { force: true }),
        fs.promises.rm(path.join(masteredDir, `mastered_${uploadedName}`), { force: true }),
      ]);
    }
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});
