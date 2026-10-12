#!/usr/bin/env bash
set -euo pipefail
sh scripts/tests/smoke-today.test.sh
sh scripts/tests/smoke-env.test.sh
bash --posix scripts/tests/smoke-env.test.sh
