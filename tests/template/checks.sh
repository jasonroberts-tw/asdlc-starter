# POSIX-shell entry points for pure checks implemented with Node's byte-safe and JSON APIs.
# Text-only shell comparisons lose file modes, trailing newlines and tool-result associations.
# Sourced by steps.sh and selftest.sh with TEST_ROOT set. Needs Node and git, no model.
check_echo() { node "$TEST_ROOT/checks.mjs" echo "$@"; }
check_structure() { node "$TEST_ROOT/checks.mjs" structure "$@"; }
check_warnings() { node "$TEST_ROOT/checks.mjs" warnings "$@"; }
check_bootstrap() { node "$TEST_ROOT/checks.mjs" bootstrap "$@"; }
check_guard_transcript() { node "$TEST_ROOT/transcripts.mjs" guard "$@"; }
check_gates_transcript() { node "$TEST_ROOT/transcripts.mjs" gates "$@"; }
check_bypasses() { node "$TEST_ROOT/transcripts.mjs" bypasses "$@"; }
check_agent_result() { node "$TEST_ROOT/transcripts.mjs" result "$@"; }
check_work_evidence() { node "$TEST_ROOT/checks.mjs" work-evidence "$@"; }
