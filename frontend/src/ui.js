import { drawWaveform, formatTime, loadWaveformPeaks } from './waveform.js';

const apiUrl = (path) => `${import.meta.env.BASE_URL}api/${path}`.replace(/([^:]\/)\/+/g, '$1');

async function readApiError(res) {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data.error || data.message || `HTTP ${res.status}`;
  } catch {
    if (res.status === 504 || /504|Gateway Time-out/i.test(text)) {
      return '처리 시간 초과(nginx 타임아웃). deploy/nginx.conf 의 proxy_read_timeout 600s 반영 후 reload nginx 하세요.';
    }
    if (text.trimStart().startsWith('<')) {
      return '서버가 HTML 오류 페이지를 반환했습니다(HTTP ' + res.status + '). pm2 logs mastering-app 확인.';
    }
    return text.slice(0, 180) || `HTTP ${res.status}`;
  }
}

export function initUI() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="upload-area" id="uploadArea">
      <p>MP3 파일을 드래그하거나 클릭하여 업로드하세요 (여러 곡 선택 가능)</p>
      <input type="file" id="fileInput" accept=".mp3,audio/mpeg" multiple style="display:none" />
    </div>
    <div id="fileInfo" style="display:none; margin-top:1rem;">
      <p id="fileName"></p>
      <p id="fileSize"></p>
      <div id="fileList" style="margin:0.75rem 0;"></div>
      <div class="intensity-control auto-control" id="autoControl">
        <span class="intensity-label">자동 마스터링</span>
        <p class="intensity-hint">원본 음량(LUFS)과 조용한 구간 노이즈를 분석해, 크기·노이즈·피크를 자동으로 맞춥니다. 별도 조절은 필요 없습니다.</p>
      </div>
      <div id="previewWrap" class="preview-wrap" style="display:none;" aria-live="polite">
        <p id="previewHint" class="preview-hint"></p>
        <p id="previewStatus" class="preview-status"></p>
        <div class="preview-studio">
          <div class="preview-studio-head">
            <p id="previewTrackName" class="preview-track-name"></p>
            <div class="ab-toggle" role="group" aria-label="원본 또는 마스터링">
              <button type="button" class="ab-toggle-btn" id="btnModeOriginal" data-mode="original">원본</button>
              <button type="button" class="ab-toggle-btn is-active" id="btnModeMastered" data-mode="mastered">마스터링</button>
            </div>
          </div>
          <canvas id="waveformCanvas" class="waveform-canvas" height="96" aria-hidden="true"></canvas>
          <div class="preview-meta">
            <span id="previewTime" class="preview-time">0:00 / 0:00</span>
            <div class="preview-stats">
              <span class="stat-pill">LUFS <strong id="statLufs">—</strong></span>
              <span class="stat-pill">True Peak <strong id="statPeak">—</strong> dBTP</span>
            </div>
          </div>
      <div class="preview-audio-stack">
            <audio id="previewAudioOriginal" controls preload="auto" class="preview-audio preview-audio-slot"></audio>
            <audio id="previewAudioMastered" controls preload="auto" class="preview-audio preview-audio-slot is-active-slot"></audio>
          </div>
        </div>
      </div>
      <button id="masterBtn">마스터링 시작</button>
    </div>
    <div id="progressWrap" style="display:none; margin-top:1rem;">
      <p id="statusText">처리 중...</p>
      <p id="elapsedText" style="margin:0.25rem 0 0.5rem; font-size:0.9rem; opacity:0.85;">경과 시간: 0초</p>
      <div class="progress-bar"><div id="progressBar"></div></div>
    </div>
    <div id="downloadWrap" style="display:none; margin-top:1rem;">
      <p id="downloadTitle">마스터링 완료!</p>
      <div id="downloadList"></div>
    </div>
  `;

  let uploadedTracks = [];
  let previewMasterObjectUrl = null;
  let previewOriginalObjectUrl = null;
  let previewMode = 'mastered';
  let previewStats = null;
  let previewPeaks = { original: null, mastered: null };
  let previewLoadToken = 0;

  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const fileList = document.getElementById('fileList');
  const masterBtn = document.getElementById('masterBtn');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar = document.getElementById('progressBar');
  const statusText = document.getElementById('statusText');
  const elapsedText = document.getElementById('elapsedText');
  const downloadWrap = document.getElementById('downloadWrap');
  const downloadTitle = document.getElementById('downloadTitle');
  const downloadList = document.getElementById('downloadList');
  const previewWrap = document.getElementById('previewWrap');
  const previewHint = document.getElementById('previewHint');
  const previewStatus = document.getElementById('previewStatus');
  const previewTrackName = document.getElementById('previewTrackName');
  const previewAudioOriginal = document.getElementById('previewAudioOriginal');
  const previewAudioMastered = document.getElementById('previewAudioMastered');
  const waveformCanvas = document.getElementById('waveformCanvas');
  const previewTime = document.getElementById('previewTime');
  const statLufs = document.getElementById('statLufs');
  const statPeak = document.getElementById('statPeak');
  const btnModeOriginal = document.getElementById('btnModeOriginal');
  const btnModeMastered = document.getElementById('btnModeMastered');

  let elapsedTimer = null;
  let elapsedStart = 0;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.background = 'rgba(255,255,255,0.15)';
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.background = '';
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.background = '';
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) handleFiles(files);
  });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) handleFiles(files);
  });

  function getActivePreviewAudio() {
    return previewMode === 'original' ? previewAudioOriginal : previewAudioMastered;
  }

  function bindPreviewAudioEvents(audio) {
    audio.addEventListener('timeupdate', refreshWaveformProgress);
    audio.addEventListener('loadedmetadata', refreshTimeLabel);
    audio.addEventListener('seeked', refreshWaveformProgress);
  }

  bindPreviewAudioEvents(previewAudioOriginal);
  bindPreviewAudioEvents(previewAudioMastered);

  btnModeOriginal.addEventListener('click', () => setPreviewMode('original'));
  btnModeMastered.addEventListener('click', () => setPreviewMode('mastered'));

  window.addEventListener('resize', refreshWaveformProgress);

  waveformCanvas.addEventListener('click', (e) => {
    const audio = getActivePreviewAudio();
    if (!audio.duration) return;
    const rect = waveformCanvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    refreshWaveformProgress();
  });

  function handleFiles(files) {
    const mp3Files = files.filter((file) => file.name.toLowerCase().endsWith('.mp3'));
    if (!mp3Files.length) {
      alert('MP3 파일만 업로드 가능합니다.');
      return;
    }
    uploadFiles(mp3Files);
  }

  async function uploadFiles(files) {
    uploadedTracks = [];
    clearPreview();
    progressWrap.style.display = 'block';
    fileInfo.style.display = 'none';
    downloadWrap.style.display = 'none';
    downloadList.innerHTML = '';
    statusText.textContent = `업로드 중... (0/${files.length})`;
    setProgress(0);
    startElapsedTimer();

    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        statusText.textContent = `업로드 중... (${i + 1}/${files.length}) ${file.name}`;
        const track = await uploadSingleFile(file);
        uploadedTracks.push(track);
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      stopElapsedTimer();
      statusText.textContent = '업로드 완료';
      await wait(400);

      renderUploadedList();
      progressWrap.style.display = 'none';
      fileInfo.style.display = 'block';
      void loadPreviewSample();
    } catch (err) {
      stopElapsedTimer();
      progressWrap.style.display = 'none';
      alert('업로드 오류: ' + err.message);
    }
  }

  async function uploadSingleFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(apiUrl('upload'), { method: 'POST', body: formData });
    if (!res.ok) throw new Error(await readApiError(res));
    const data = await res.json();

    return {
      filename: data.filename,
      originalname: data.originalname || file.name,
      size: data.size,
    };
  }

  function renderUploadedList() {
    const totalSize = uploadedTracks.reduce((sum, track) => sum + (track.size || 0), 0);
    fileName.textContent = `선택 곡 수: ${uploadedTracks.length}곡`;
    fileSize.textContent = `총 용량: ${(totalSize / 1024 / 1024).toFixed(2)} MB`;

    const items = uploadedTracks
      .map((track, idx) => `${idx + 1}. ${track.originalname} (${(track.size / 1024).toFixed(1)} KB)`)
      .join('<br/>');
    fileList.innerHTML = items;
    masterBtn.textContent = `마스터링 시작 (${uploadedTracks.length}곡)`;
  }

  function clearPreview() {
    if (previewMasterObjectUrl) {
      URL.revokeObjectURL(previewMasterObjectUrl);
      previewMasterObjectUrl = null;
    }
    if (previewOriginalObjectUrl) {
      URL.revokeObjectURL(previewOriginalObjectUrl);
      previewOriginalObjectUrl = null;
    }
    previewStats = null;
    previewPeaks = { original: null, mastered: null };
    previewMode = 'mastered';
    previewAudioOriginal.removeAttribute('src');
    previewAudioMastered.removeAttribute('src');
    previewAudioOriginal.load();
    previewAudioMastered.load();
    previewAudioOriginal.classList.remove('is-active-slot');
    previewAudioMastered.classList.add('is-active-slot');
    if (previewWrap) previewWrap.style.display = 'none';
    if (previewStatus) previewStatus.textContent = '';
    setPreviewWaiting(false);
    btnModeOriginal.classList.remove('is-active');
    btnModeMastered.classList.add('is-active');
  }

  function setPreviewMode(mode) {
    if (!previewOriginalObjectUrl || !previewMasterObjectUrl) return;
    const prev = getActivePreviewAudio();
    const next = mode === 'original' ? previewAudioOriginal : previewAudioMastered;
    const t = prev.currentTime || 0;
    const wasPlaying = !prev.paused;

    previewMode = mode;
    btnModeOriginal.classList.toggle('is-active', mode === 'original');
    btnModeMastered.classList.toggle('is-active', mode === 'mastered');
    previewAudioOriginal.classList.toggle('is-active-slot', mode === 'original');
    previewAudioMastered.classList.toggle('is-active-slot', mode === 'mastered');

    prev.pause();

    const applySeek = () => {
      if (Number.isFinite(next.duration) && next.duration > 0) {
        next.currentTime = Math.min(Math.max(0, t), Math.max(0, next.duration - 0.01));
      }
      if (wasPlaying) void next.play().catch(() => {});
      updateStatsDisplay();
      refreshWaveformProgress();
    };

    if (next.readyState >= 1) applySeek();
    else next.addEventListener('loadedmetadata', applySeek, { once: true });
  }

  function updateStatsDisplay() {
    const stats = previewStats?.[previewMode === 'original' ? 'original' : 'mastered'];
    if (!stats) {
      statLufs.textContent = '—';
      statPeak.textContent = '—';
      return;
    }
    statLufs.textContent = stats.lufs != null ? `${stats.lufs} LUFS` : '—';
    statPeak.textContent = stats.truePeak != null ? String(stats.truePeak) : '—';
  }

  function refreshTimeLabel() {
    const audio = getActivePreviewAudio();
    const cur = formatTime(audio.currentTime);
    const total = formatTime(audio.duration);
    previewTime.textContent = `${cur} / ${total}`;
  }

  function refreshWaveformProgress() {
    refreshTimeLabel();
    const peaks = previewPeaks[previewMode];
    if (!peaks) return;
    const audio = getActivePreviewAudio();
    const ratio = audio.duration ? audio.currentTime / audio.duration : 0;
    drawWaveform(waveformCanvas, peaks.peaks, ratio, previewMode === 'original' ? 'original' : 'master');
  }

  function setPreviewWaiting(isWaiting) {
    if (previewStatus) previewStatus.classList.toggle('is-waiting', isWaiting);
  }

  async function ensureLoggedIn() {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) return true;
    window.location.href = `/login?next=${encodeURIComponent('/mastering/')}`;
    return false;
  }

  async function loadPreviewSample() {
    if (!uploadedTracks.length || !previewWrap) return;

    const loadToken = ++previewLoadToken;
    const track = uploadedTracks[0];
    previewWrap.style.display = 'block';
    previewTrackName.textContent = track.originalname;
    previewHint.textContent =
      uploadedTracks.length > 1
        ? `여러 곡 업로드됨 — 샘플은 1번째 곡만 미리듣기·파형·LUFS 비교합니다.`
        : `토글로 원본·마스터링을 바꿔 들으며 음질 차이를 확인하세요.`;
    previewStatus.textContent = '샘플 마스터링·분석 중… (잠시만 기다려 주세요)';
    setPreviewWaiting(true);
    previewAudioOriginal.removeAttribute('src');
    previewAudioMastered.removeAttribute('src');

    try {
      const originalFetchUrl = apiUrl(`upload/original/${encodeURIComponent(track.filename)}`);

      const res = await fetch(apiUrl('master/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: track.filename,
          originalname: track.originalname,
          intensity: 'auto',
        }),
      });

      if (!res.ok) throw new Error(await readApiError(res));
      if (loadToken !== previewLoadToken) return;

      const statsHeader = res.headers.get('X-Preview-Stats');
      if (statsHeader) {
        try {
          previewStats = JSON.parse(statsHeader);
        } catch {
          previewStats = null;
        }
      }

      const [origRes, masterBlob] = await Promise.all([
        fetch(originalFetchUrl),
        res.blob(),
      ]);
      if (!origRes.ok) throw new Error('원본 파일을 불러오지 못했습니다.');
      if (loadToken !== previewLoadToken) return;

      const origBlob = await origRes.blob();
      if (previewOriginalObjectUrl) URL.revokeObjectURL(previewOriginalObjectUrl);
      if (previewMasterObjectUrl) URL.revokeObjectURL(previewMasterObjectUrl);
      previewOriginalObjectUrl = URL.createObjectURL(origBlob);
      previewMasterObjectUrl = URL.createObjectURL(masterBlob);

      previewStatus.textContent = '파형 생성 중…';
      setPreviewWaiting(true);
      const [originalWave, masteredWave] = await Promise.all([
        loadWaveformPeaks(origBlob),
        loadWaveformPeaks(masterBlob),
      ]);
      previewPeaks.original = originalWave;
      previewPeaks.mastered = masteredWave;

      previewMode = 'mastered';
      btnModeOriginal.classList.remove('is-active');
      btnModeMastered.classList.add('is-active');
      previewAudioOriginal.classList.remove('is-active-slot');
      previewAudioMastered.classList.add('is-active-slot');
      previewAudioOriginal.src = previewOriginalObjectUrl;
      previewAudioMastered.src = previewMasterObjectUrl;
      updateStatsDisplay();
      refreshWaveformProgress();
      previewStatus.textContent = '원본 ↔ 마스터링 토글로 비교해 보세요.';
      if (previewStats?.auto?.targetLufs != null && previewStats?.original?.lufs != null) {
        previewHint.textContent = `자동 분석: 원본 ${previewStats.original.lufs} LUFS → 목표 약 ${previewStats.auto.targetLufs} LUFS (원본에 맞춤)`;
      }
      setPreviewWaiting(false);
    } catch (err) {
      if (loadToken !== previewLoadToken) return;
      previewStatus.textContent = '미리듣기 생성 실패: ' + err.message;
      setPreviewWaiting(false);
    }
  }

  masterBtn.addEventListener('click', async () => {
    if (!uploadedTracks.length) return;
    if (!(await ensureLoggedIn())) return;

    fileInfo.style.display = 'none';
    downloadWrap.style.display = 'none';
    progressWrap.style.display = 'block';
    statusText.textContent = `마스터링 처리 중... (0/${uploadedTracks.length})`;
    setProgress(0);
    startElapsedTimer();

    try {
      const results = [];
      for (let i = 0; i < uploadedTracks.length; i += 1) {
        const track = uploadedTracks[i];
        statusText.textContent = `마스터링 처리 중... (${i + 1}/${uploadedTracks.length}) ${track.originalname}`;
        const result = await masterSingleTrack(track);
        results.push(result);
        setProgress(Math.round(((i + 1) / uploadedTracks.length) * 100));
      }

      stopElapsedTimer();
      statusText.textContent = '마스터링 완료';
      await wait(400);
      progressWrap.style.display = 'none';

      renderDownloadList(results);
      downloadWrap.style.display = 'block';
    } catch (err) {
      stopElapsedTimer();
      progressWrap.style.display = 'none';
      fileInfo.style.display = 'block';
      alert('마스터링 오류: ' + err.message);
    }
  });

  async function masterSingleTrack(track) {
    const res = await fetch(apiUrl('master'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        filename: track.filename,
        originalname: track.originalname,
        intensity: 'auto',
      }),
    });

    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent('/mastering/')}`;
      throw new Error('로그인이 필요합니다.');
    }

    if (!res.ok) {
      throw new Error(await readApiError(res));
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const serverFilename = parseFilenameFromHeader(res.headers.get('content-disposition'));

    return {
      url,
      filename: serverFilename || ensureMp3Extension(track.originalname),
    };
  }

  function renderDownloadList(results) {
    downloadTitle.textContent = `마스터링 완료 (${results.length}곡)`;
    downloadList.innerHTML = '';

    results.forEach((result, idx) => {
      const row = document.createElement('div');
      row.className = 'download-row';

      const link = document.createElement('a');
      link.href = result.url;
      link.download = result.filename;
      link.textContent = `${idx + 1}. ${result.filename} 다운로드`;

      row.appendChild(link);
      downloadList.appendChild(row);
    });
  }

  function setProgress(pct) {
    const safe = Math.max(0, Math.min(100, pct));
    progressBar.style.width = safe + '%';
  }

  function startElapsedTimer() {
    stopElapsedTimer();
    elapsedStart = Date.now();
    elapsedText.textContent = '경과 시간: 0초';
    elapsedTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - elapsedStart) / 1000);
      elapsedText.textContent = `경과 시간: ${sec}초`;
    }, 250);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function parseFilenameFromHeader(contentDisposition) {
    if (!contentDisposition) return null;

    const starMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (starMatch && starMatch[1]) {
      try {
        return decodeURIComponent(starMatch[1]);
      } catch (_) {
        /* fallback */
      }
    }

    const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    if (plainMatch && plainMatch[1]) return plainMatch[1];
    return null;
  }

  function ensureMp3Extension(name) {
    return /\.mp3$/i.test(name) ? name : `${name}.mp3`;
  }
}
