#!/bin/sh
set -eu

api_base_url="${ABP_API_BASE_URL:-/api/v1}"
escaped_api_base_url="$(printf '%s' "$api_base_url" | sed 's/["\\]/\\&/g')"
local_test_user_id="${ABP_LOCAL_TEST_USER_ID:-}"
local_test_session_id="${ABP_LOCAL_TEST_SESSION_ID:-}"
escaped_local_test_user_id="$(printf '%s' "$local_test_user_id" | sed 's/["\\]/\\&/g')"
escaped_local_test_session_id="$(printf '%s' "$local_test_session_id" | sed 's/["\\]/\\&/g')"

printf 'window.__ABP_RUNTIME_CONFIG__ = Object.freeze({ apiBaseUrl: "%s", localTestUserId: "%s", localTestSessionId: "%s" });\n' \
  "$escaped_api_base_url" "$escaped_local_test_user_id" "$escaped_local_test_session_id" \
  > /usr/share/nginx/html/runtime-config.js
