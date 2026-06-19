const { spawn } = require('child_process');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 && !stderr.includes('input_i')) {
        return reject(new Error(stderr.slice(-400) || `ffmpeg exit ${code}`));
      }
      resolve(stderr);
    });
  });
}

function parseDuration(stderr) {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Integrated LUFS·True Peak (ffmpeg loudnorm 분석) */
async function analyzeLoudness(filePath) {
  const stderr = await runFfmpeg([
    '-hide_banner',
    '-i',
    filePath,
    '-af',
    'loudnorm=print_format=json',
    '-f',
    'null',
    '-',
  ]);

  const duration = parseDuration(stderr);
  const jsonMatch = stderr.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    return { lufs: null, truePeak: null, lufsRange: null, duration };
  }

  try {
    const data = JSON.parse(jsonMatch[0]);
    return {
      lufs: Number.isFinite(Number(data.input_i)) ? Number(Number(data.input_i).toFixed(1)) : null,
      truePeak: Number.isFinite(Number(data.input_tp)) ? Number(Number(data.input_tp).toFixed(1)) : null,
      lufsRange: Number.isFinite(Number(data.input_lra)) ? Number(Number(data.input_lra).toFixed(1)) : null,
      duration,
    };
  } catch {
    return { lufs: null, truePeak: null, lufsRange: null, duration };
  }
}

/** 인트로 등 조용 구간 RMS (Overall, dB) */
async function analyzeQuietRms(filePath, startSec = 0, durationSec = 5) {
  const stderr = await runFfmpeg([
    '-hide_banner',
    '-i',
    filePath,
    '-ss',
    String(startSec),
    '-t',
    String(durationSec),
    '-af',
    'astats=metadata=0:reset=1',
    '-f',
    'null',
    '-',
  ]);

  const matches = [...stderr.matchAll(/RMS level dB:\s*([-\d.]+)/g)];
  if (!matches.length) return null;
  const n = Number(matches[matches.length - 1][1]);
  return Number.isFinite(n) ? n : null;
}

module.exports = { analyzeLoudness, analyzeQuietRms };
