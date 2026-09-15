#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$repo_root/packages/coding-agent"

output="$(bun test test/model-role-presets.test.ts test/model-resolver.test.ts test/model-hub.test.ts 2>&1)" || {
  printf '%s\n' "$output"
  exit 1
}
printf '%s\n' "$output"
suite_ms="$(printf '%s\n' "$output" | sed -nE 's/.*\[([0-9.]+)ms\].*/\1/p' | awk 'END { print }')"
passed="$(printf '%s\n' "$output" | sed -nE 's/^[[:space:]]*([0-9][0-9]*) pass.*/\1/p' | awk 'END { print }')"
if [ -z "$suite_ms" ] || [ -z "$passed" ]; then
  printf '%s\n' "Unable to parse benchmark output" >&2
  exit 1
fi
printf 'METRIC model_role_suite_ms=%s\n' "$suite_ms"
printf 'METRIC model_role_tests=%s\n' "$passed"
