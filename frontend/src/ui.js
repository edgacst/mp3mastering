const apiUrl = (path) => `${import.meta.env.BASE_URL}api/${path}`.replace(/([^:]\/)\/+/g, '$1');

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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '업로드 실패');

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
      const data = await res.json();
      throw new Error(data.error || '마스터링 실패');
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
