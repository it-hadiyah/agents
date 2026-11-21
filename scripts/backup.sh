#!/usr/bin/env bash
# نسخ احتياطي لقاعدة البيانات والمرفقات. الاستعادة: انظر docs/OPERATIONS.md
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${DATABASE_URL:?DATABASE_URL مطلوب}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
umask 077
mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --no-owner "$DATABASE_URL" -f "$BACKUP_DIR/db-$STAMP.dump"
if [ -d "${UPLOAD_DIR:-./uploads}" ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "${UPLOAD_DIR:-./uploads}" .
fi
# الاحتفاظ بآخر 14 نسخة
ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "تم النسخ الاحتياطي: $BACKUP_DIR/db-$STAMP.dump"
