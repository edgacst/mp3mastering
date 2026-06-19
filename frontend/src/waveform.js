/** URL·Blob → 파형 피크 + 재생 시간 */
export async function loadWaveformPeaks(source, barCount = 220) {
  const buffer =
    source instanceof Blob
      ? await source.arrayBuffer()
      : await (await fetch(source, { credentials: 'same-origin' })).arrayBuffer();

  const ctx = new AudioContext();
  try {
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / barCount));
    const peaks = [];

    for (let i = 0; i < barCount; i += 1) {
      let max = 0;
      const start = i * step;
      for (let j = 0; j < step; j += 1) {
        max = Math.max(max, Math.abs(channel[start + j] || 0));
      }
      peaks.push(max);
    }

    return { peaks, duration: audioBuffer.duration };
  } finally {
    await ctx.close();
  }
}

export function drawWaveform(canvas, peaks, progressRatio, variant = 'master') {
  if (!canvas || !peaks?.length) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 640;
  const height = canvas.clientHeight || 96;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, height);

  const bg = g.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, 'rgba(15, 28, 48, 0.95)');
  bg.addColorStop(1, 'rgba(8, 16, 30, 0.95)');
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);

  const barW = width / peaks.length;
  const mid = height / 2;
  const playedX = Math.max(0, Math.min(1, progressRatio || 0)) * width;

  peaks.forEach((peak, i) => {
    const x = i * barW;
    const h = Math.max(2, peak * (height * 0.82));
    const isPlayed = x + barW <= playedX;
    const grad = g.createLinearGradient(0, mid - h / 2, 0, mid + h / 2);

    if (variant === 'original') {
      grad.addColorStop(0, isPlayed ? '#94a3b8' : '#475569');
      grad.addColorStop(1, isPlayed ? '#64748b' : '#334155');
    } else {
      grad.addColorStop(0, isPlayed ? '#67e8f9' : '#155e75');
      grad.addColorStop(1, isPlayed ? '#facc15' : '#713f12');
    }

    g.fillStyle = grad;
    g.fillRect(x + 0.5, mid - h / 2, Math.max(1, barW - 1), h);
  });

  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(playedX, 0);
  g.lineTo(playedX, height);
  g.stroke();
}

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
