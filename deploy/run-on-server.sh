#!/bin/bash
# Host w3 마스터링 앱 서버 배포 (Hostinger VPS)
# 사용: bash deploy/run-on-server.sh
# 경로: /var/www/mp3mastering

set -e
APP_DIR="${APP_DIR:-/var/www/mp3mastering}"
PORT="${PORT:-3001}"

echo "=========================================="
echo "MP3 마스터링 배포: $APP_DIR (PORT=$PORT)"
echo "=========================================="

cd "$APP_DIR" || { echo "오류: $APP_DIR 없음"; exit 1; }

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "오류: ffmpeg 미설치. sudo apt install -y ffmpeg 후 다시 실행하세요."
  exit 1
fi

echo "[1/6] git pull..."
git pull origin main
echo ""

echo "[2/6] npm install (root)..."
npm install
echo ""

echo "[3/6] npm install (frontend — vite 등 빌드 도구)..."
npm --prefix frontend install --include=dev
echo ""

echo "[4/6] frontend build (base=/mastering/)..."
npm run build
echo ""

echo "[5/6] backend install..."
npm --prefix backend install --omit=dev
echo ""

echo "[6/6] PM2 restart mastering-app..."
if pm2 describe mastering-app >/dev/null 2>&1; then
  PORT="$PORT" pm2 restart mastering-app --update-env
else
  PORT="$PORT" pm2 start "npm --prefix backend start" --name mastering-app
fi
pm2 save
echo ""

curl -sI "http://127.0.0.1:${PORT}/" | head -3 || true
echo "=========================================="
echo "완료. 브라우저: https://venysound.com/mastering/"
echo "=========================================="
