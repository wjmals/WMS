#!/bin/bash
# WMS 시스템 전체 시작 스크립트
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🐘 PostgreSQL 시작 중..."
cd "$ROOT_DIR"
docker compose up -d postgres

echo "🦀 Rust API 서버 시작 중 (포트 8080)..."
cd "$ROOT_DIR/rust-backend"
set -a
if [[ -f .env ]]; then source .env; fi
if [[ -f .env.local ]]; then source .env.local; fi
set +a
export DATABASE_URL="${DATABASE_URL:-postgres://wms:wms_password@localhost:5432/wms}"
export RUST_LOG="${RUST_LOG:-warn}"
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
if [[ -z "${SUPER_ADMIN_PASSWORD:-}" ]]; then
	printf '오류: rust-backend/.env에 SUPER_ADMIN_PASSWORD를 설정한 뒤 다시 실행하세요.\n' >&2
	exit 1
fi
cargo build --quiet
./target/debug/wms-api &
RUST_PID=$!
echo "  Rust PID: $RUST_PID"
sleep 2

echo "⚡ Next.js 프론트엔드 시작 중 (포트 3000)..."
cd "$ROOT_DIR/frontend"
npm run dev &
NEXT_PID=$!
echo "  Next.js PID: $NEXT_PID"

echo ""
echo "✅ 모든 서비스 시작 완료!"
echo "   프론트엔드: http://localhost:3000"
echo "   Rust API:   http://localhost:8080"
echo "   PostgreSQL: localhost:5432 (DB: wms, User: wms, PW: wms_password)"
echo ""
echo "📊 TablePlus 연결 정보:"
echo "   Host: 127.0.0.1  Port: 5432"
echo "   Database: wms    User: wms    Password: wms_password"
echo ""
echo "종료하려면 Ctrl+C 후: docker-compose stop postgres"

wait
