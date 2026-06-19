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
      return `서버가 HTML 오류 페이지를 반환했습니다(HTTP ${res.status}). pm2 logs mastering-app 확인.`;
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
      <div id="previewWrap" class="preview-wrap" style="display:none;" aria-live="polite">
        <p id="previewTitle" class="preview-title">음질 비교 미리듣기</p>
        <p id="previewHint" class="preview-hint"></p>
        <p id="previewStatus" class="preview-status"></p>
        <div class="preview-grid">
          <div class="preview-col">
            <span class="preview-label preview-label-original">원본 음질</span>
            <audio id="previewOriginal" controls preload="metadata" class="preview-audio"></audio>
          </div>
          <div class="preview-col">
            <span class="preview-label preview-label-master">마스터링 음질</span>
            <audio id="previewMastered" controls preload="metadata" class="preview-audio"></audio>
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
  const previewTitle = document.getElementById('previewTitle');
  const previewHint = document.getElementById('previewHint');
  const previewStatus = document.getElementById('previewStatus');
  const previewOriginal = document.getElementById('previewOriginal');
  const previewMastered = document.getElementById('previewMastered');

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
      size: data.size
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
    if (previewOriginal) previewOriginal.removeAttribute('src');
    if (previewMastered) previewMastered.removeAttribute('src');
    if (previewWrap) previewWrap.style.display = 'none';
    if (previewStatus) previewStatus.textContent = '';
  }

  function wireExclusiveAudioPlayback(a, b) {
    if (a.dataset.abWired === '1') return;
    a.dataset.abWired = '1';
    b.dataset.abWired = '1';
    a.addEventListener('play', () => {
      if (!b.paused) b.pause();
    });
    b.addEventListener('play', () => {
      if (!a.paused) a.pause();
    });
  }

  /** 여러 곡이어도 1번째 곡만 샘플 마스터링 후 A/B 미리듣기 */
  async function loadPreviewSample() {
    if (!uploadedTracks.length || !previewWrap) return;

    const track = uploadedTracks[0];
    previewWrap.style.display = 'block';
    previewTitle.textContent = '음질 비교 미리듣기';
    previewHint.textContent =
      uploadedTracks.length > 1
        ? `여러 곡 업로드됨 — 샘플은 1번째 곡「${track.originalname}」만 미리듣기합니다.`
        : `「${track.originalname}」 원본 vs 마스터링 결과를 비교해 보세요.`;
    previewStatus.textContent = '샘플 마스터링 생성 중… (잠시만 기다려 주세요)';
    previewOriginal.removeAttribute('src');
    previewMastered.removeAttribute('src');

    try {
      const originalSrc = apiUrl(`upload/original/${encodeURIComponent(track.filename)}`);
      previewOriginal.src = originalSrc;

      const res = await fetch(apiUrl('master/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: track.filename, originalname: track.originalname }),
      });

      if (!res.ok) throw new Error(await readApiError(res));

      const blob = await res.blob();
      if (previewMasterObjectUrl) URL.revokeObjectURL(previewMasterObjectUrl);
      previewMasterObjectUrl = URL.createObjectURL(blob);
      previewMastered.src = previewMasterObjectUrl;

      wireExclusiveAudioPlayback(previewOriginal, previewMastered);
      previewStatus.textContent = '재생 버튼을 눌러 원본·마스터링 음질을 비교해 보세요.';
    } catch (err) {
      previewStatus.textContent = '미리듣기 생성 실패: ' + err.message;
    }
  }

  masterBtn.addEventListener('click', async () => {
    if (!uploadedTracks.length) return;

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
      body: JSON.stringify({ filename: track.filename, originalname: track.originalname })
    });

    if (!res.ok) {
      throw new Error(await readApiError(res));
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const serverFilename = parseFilenameFromHeader(res.headers.get('content-disposition'));

    return {
      url,
      filename: serverFilename || ensureMp3Extension(track.originalname)
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

    // RFC 5987: filename*=UTF-8''...
    const starMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (starMatch && starMatch[1]) {
      try {
        return decodeURIComponent(starMatch[1]);
      } catch (_) {
        // decode 실패 시 아래 fallback 로직 진행
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
