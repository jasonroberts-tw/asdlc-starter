#!/bin/sh
# Negative-tests the pure Template checks without Deploy, npm or a model.
# An always-green checker would make the container run report success over a broken Target.
#   pwsh -File tests/template/run.ps1 -Selftest
# Needs the image's Node and git. Fixtures live only under the temporary directory.
set -eu
TEST_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$TEST_ROOT/checks.sh"
node --test "$TEST_ROOT/checks.selftest.mjs" "$TEST_ROOT/transcripts.selftest.mjs" "$TEST_ROOT/agent.selftest.mjs" "$TEST_ROOT/work.selftest.mjs"
