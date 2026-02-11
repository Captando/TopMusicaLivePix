#!/usr/bin/env bash
set -euo pipefail

value="${1:-10}"
message="${2:-https://youtu.be/dQw4w9WgXcQ}"
sender="${3:-Tester}"
port="${PORT:-3000}"
token="${WEBHOOK_SECRET:-}"

qs=""
if [[ -n "$token" ]]; then
  qs="?token=${token}"
fi

curl -sS -X POST "http://localhost:${port}/webhook/livepix${qs}" \
  -H "content-type: application/json" \
  -d "{\"value\": ${value}, \"message\": \"${message}\", \"sender\": \"${sender}\", \"status\": \"paid\"}" | cat
echo

