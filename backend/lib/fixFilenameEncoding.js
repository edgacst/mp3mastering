/** 파일명 mojibake 점수 (낮을수록 정상) */
function mojibakeScore(name) {
  if (!name) return 999;
  let score = 0;
  if (/\uFFFD/.test(name)) score += 20;
  if (/â€™|â€˜|â€œ|â€"/.test(name)) score += 8;
  if (/â€/.test(name)) score += 6;
  if (/â./.test(name)) score += 4;
  if (/Ã./.test(name)) score += 4;
  if (/ï¿½/.test(name)) score += 10;
  return score;
}

function pickBetterFilename(...candidates) {
  let best = '';
  let bestScore = 999;
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name) continue;
    const score = mojibakeScore(name);
    if (score < bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

/** multipart latin1 깨짐·스마트부호 mojibake 보정 */
function fixEncoding(name) {
  if (!name || typeof name !== 'string') return name;

  const candidates = [name];

  try {
    const fromLatin1 = Buffer.from(name, 'latin1').toString('utf8');
    if (fromLatin1 && !fromLatin1.includes('\uFFFD')) candidates.push(fromLatin1);
  } catch (_) {
    /* ignore */
  }

  candidates.push(
    name
      .replace(/â€™/g, '\u2019')
      .replace(/â€˜/g, '\u2018')
      .replace(/â€œ/g, '\u201C')
      .replace(/â€/g, '\u201D')
      .replace(/â€"/g, '\u2014')
      .replace(/â€¦/g, '\u2026')
      .replace(/Ã©/g, 'é')
      .replace(/Ã¨/g, 'è')
      .replace(/Ã /g, 'à'),
  );

  const best = pickBetterFilename(...candidates);
  return best || name;
}

module.exports = { fixEncoding, pickBetterFilename, mojibakeScore };
