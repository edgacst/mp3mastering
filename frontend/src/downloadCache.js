const DB_NAME = 'venysound-mastering';
const STORE = 'downloads';
const TTL_MS = 24 * 60 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 마스터링 결과 blob 저장 (같은 브라우저·24시간) */
export async function saveDownloads(items) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  store.clear();
  const savedAt = Date.now();
  items.forEach((item, index) => {
    store.put({
      id: item.id || `dl-${savedAt}-${index}`,
      filename: item.filename,
      blob: item.blob,
      savedAt,
    });
  });
  await txDone(tx);
  db.close();
}

/** 저장된 다운로드 불러오기 */
export async function loadDownloads() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  const rows = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  db.close();
  const now = Date.now();
  return rows.filter((row) => row.blob && now - row.savedAt < TTL_MS);
}

export async function clearDownloads() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await txDone(tx);
  db.close();
}
