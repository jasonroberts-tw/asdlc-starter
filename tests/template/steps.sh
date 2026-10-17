#!/bin/sh
# Runs the Template contract in disposable Alice/Bob clones, stopping after the first failed step.
# A green source checkout is insufficient evidence that its remote can bootstrap a second machine.
#   mise exec -- sh tests/template/steps.sh (through run.ps1 inside the Template image)
# Needs git, bd, Node, npm, mise and the image's Bootstrap entrypoint; no GitHub or key.
set -u
TEST_ROOT=${TEMPLATE_TEST_HARNESS_ROOT:-/src/tests/template}
. "$TEST_ROOT/checks.sh"
OUT=/out
mkdir -p "$OUT/steps" /work/claude
RESULTS="$OUT/results.txt"
export TEMPLATE_TEST_RESULTS="$RESULTS"
: >"$RESULTS"
VERDICT=FAIL
AGENT_SKIP=0
if [ -z "${ANTHROPIC_API_KEY:-}${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then AGENT_SKIP=1; fi
finish() {
    number=0
    for name in Deploy Structure Bootstrap Gates Guards Canary Work-run; do
        number=$((number + 1))
        if ! grep -E "^(PASS|FAIL|SKIP) $number $name" "$RESULTS" >/dev/null; then
            printf 'SKIP %s %s: an earlier step failed\n' "$number" "$name" >>"$RESULTS"
        fi
    done
    {
        if [ "$AGENT_SKIP" = 1 ]; then printf 'AGENT STEPS SKIPPED: no model credential\n'; fi
        printf 'VERDICT: %s\n' "$VERDICT"
        cat "$RESULTS"
    } >"$OUT/summary.txt"
    cat "$OUT/summary.txt"
    if git -C /work/bob rev-parse --verify HEAD >/dev/null 2>&1; then
        git -C /work/bob bundle create "$OUT/target.bundle" --all 2>>"$OUT/bundles.log" || true
    elif git -C /work/alice rev-parse --verify HEAD >/dev/null 2>&1; then
        git -C /work/alice bundle create "$OUT/target.bundle" --all 2>>"$OUT/bundles.log" || true
    fi
    git --git-dir=/work/origin.git bundle create "$OUT/origin.bundle" --all 2>>"$OUT/bundles.log" || true
}
trap finish EXIT
git config --global user.name 'Template Test'
git config --global user.email template-test@example.invalid
{
    printf 'asdlc-starter: %s\ndirty: %s\nimage: %s\nmodel: %s\n' "${TEMPLATE_TEST_COMMIT:-unknown}" \
        "${TEMPLATE_TEST_DIRTY:-unknown}" "${TEMPLATE_TEST_IMAGE:-unknown}" "${TEMPLATE_TEST_MODEL:-claude-sonnet-5-5}"
    claude --version
    node --version
    bd version
    "$(mise which gh)" --version
    git --version
    mise --version
} >"$OUT/versions.txt" 2>&1
check() {
    label=$1; shift
    if "$@"; then printf 'PASS %s\n' "$label" >>"$RESULTS"
    else printf 'FAIL %s (see step log)\n' "$label" >>"$RESULTS"; STEP_FAILED=1; fi
}
step() {
    number=$1; name=$2; function=$3
    if (STEP_FAILED=0; "$function" || STEP_FAILED=1; exit "$STEP_FAILED") >"$OUT/steps/$number-$name.log" 2>&1; then
        printf 'PASS %s %s\n' "$number" "$name" >>"$RESULTS"
        cat "$OUT/steps/$number-$name.log"
    else
        printf 'FAIL %s %s\n' "$number" "$name" >>"$RESULTS"
        cat "$OUT/steps/$number-$name.log"
        exit 1
    fi
}
deploy() {
    git init --bare --initial-branch=main /work/origin.git || return 1
    git init --initial-branch=main /work/alice || return 1
    git -C /work/alice remote add origin /work/origin.git || return 1
    deploy_path=${TEMPLATE_TEST_DEPLOY:-/src/scripts/deploy.mjs}
    if [ ! -f "$deploy_path" ]; then
        printf 'Deploy not found: %s\n' "$deploy_path"
        printf 'FAIL Deploy not found: %s\n' "$deploy_path" >>"$RESULTS"
        STEP_FAILED=1
        return
    fi
    check 'Deploy exits 0' node "$deploy_path" --values "$TEST_ROOT/fixtures/values.json" /work/alice
}
one_commit() { [ "$(git --git-dir=/work/origin.git rev-list --count main)" = 1 ]; }
same_main() { [ "$(git -C /work/alice rev-parse main)" = "$(git --git-dir=/work/origin.git rev-parse main)" ]; }
alice_main() { [ "$(git -C /work/alice branch --show-current)" = main ]; }
clean_alice() { [ -z "$(git -C /work/alice status --porcelain)" ]; }
structure() {
    check 'origin main has one commit' one_commit
    check 'Alice main equals origin main' same_main
    check 'Alice is on main' alice_main
    check 'Template tree, rendered integrations and Tracker files' check_structure /src "$TEST_ROOT/fixtures/values.json" /work/origin.git /work/alice "$TEST_ROOT/fixtures"
    check 'origin holds the Tracker' git --git-dir=/work/origin.git rev-parse --verify refs/dolt/data
    check 'Alice has a clean working tree' clean_alice
}
bootstrap_route() {
    (cd /work/bob && REPO_WORKSPACE=/work/bob GITHUB_APP_WORKSPACE=/work/bob workspace-entrypoint true) >"$OUT/bootstrap.log" 2>&1
    bootstrap_status=$?
    cat "$OUT/bootstrap.log"
    return "$bootstrap_status"
}
# The host's route, run again over the container's: every install step finds nothing to do.
host_bootstrap() {
    (cd /work/bob && mise run bootstrap) >"$OUT/host-bootstrap.log" 2>&1
    host_status=$?
    cat "$OUT/host-bootstrap.log"
    [ "$host_status" -eq 0 ] || return 1
    for step in '3. packages' '4. the git hooks' '5. the Tracker'; do
        grep -F "[bootstrap] $step: nothing to do" "$OUT/host-bootstrap.log" >/dev/null || return 1
    done
}
clean_bob() { [ -z "$(git -C /work/bob status --porcelain)" ]; }
bootstrap() {
    git clone /work/origin.git /work/bob || return 1
    check 'Bootstrap route exits 0' bootstrap_route
    check 'Bootstrap lock hash, git hooks and embedded Tracker' check_bootstrap /work/bob
    check 'Bob reads the hydrated Tracker' env NO_COLOR=1 bd -C /work/bob list --json
    check 'Bootstrap ran the doctor, which found no fail' check_doctor "$OUT/bootstrap.log"
    check 'host Bootstrap route repeats with nothing to install' host_bootstrap
    check 'checkout hook syncs a changed skill-sources record, and the doctor reports its drift' check_skills_hook /work/bob
    check 'Bootstrap warnings are expected' check_warnings "$OUT/bootstrap.log" "$TEST_ROOT/expected-warnings.txt"
    check 'host Bootstrap warnings are expected' check_warnings "$OUT/host-bootstrap.log" "$TEST_ROOT/expected-warnings.txt"
    check 'Bootstrap leaves Bob clean' clean_bob
}
bad_push() {
    git -C /work/bob switch -c template-test/probe || return 1
    printf 'A dangling citation: missing-template-test.md § "Missing".\n' >/work/bob/template-test-bad.md
    git -C /work/bob add template-test-bad.md || return 1
    git -C /work/bob commit -m 'Probe a dangling citation' || return 1
    git -C /work/bob push origin HEAD:refs/heads/template-test/probe >"$OUT/bad-push.log" 2>&1
    push_status=$?
    cat "$OUT/bad-push.log"
    [ "$push_status" -ne 0 ] && grep -E 'citations.*(FAILED|failed)' "$OUT/bad-push.log" >/dev/null || return 1
    if git --git-dir=/work/origin.git show-ref --verify --quiet refs/heads/template-test/probe; then return 1; fi
}
good_push() {
    git -C /work/bob reset --hard main || return 1
    git -C /work/bob commit --allow-empty -m 'Probe a valid push' || return 1
    git -C /work/bob push origin HEAD:refs/heads/template-test/probe || return 1
    [ "$(git --git-dir=/work/origin.git rev-parse refs/heads/template-test/probe)" = "$(git -C /work/bob rev-parse HEAD)" ]
}
gates() {
    check 'every CI mise step in deployed order' node "$TEST_ROOT/checks.mjs" ci /work/bob
    check 'full pre-push suite' sh -c 'cd /work/bob && mise run gates'
    check 'installed pre-push refuses a dangling citation' bad_push
    check 'installed pre-push allows a valid empty commit' good_push
    check 'return Bob to main' git -C /work/bob switch main
    check 'Gates leaves Bob clean' clean_bob
}
guards() {
    check 'Guards fixture coverage and live hook commands' node "$TEST_ROOT/checks.mjs" guards /work/bob "$TEST_ROOT/fixtures/hook-payloads"
    check 'Guards leaves Bob clean' clean_bob
}
agent_command() {
    phase=$1; root=$2; prompt=$3; transcript=$4
    node "$TEST_ROOT/agent.mjs" "$phase" "$root" "$prompt" "$transcript" "$OUT/$phase.stderr.log"
    agent_status=$?
    cat "$OUT/$phase.stderr.log"
    return "$agent_status"
}
canary_no_commit() { [ "$(git -C /work/canary rev-parse HEAD)" = "$DEPLOY_COMMIT" ]; }
canary() {
    cp -R /work/bob /work/canary || return 1
    check 'Canary completes within limits' agent_command canary /work/canary "$TEST_ROOT/prompts/canary.md" "$OUT/canary.jsonl"
    check 'Canary echo behavior' mise -C /work/canary exec -- node "$TEST_ROOT/checks.mjs" echo /work/canary/echo.mjs
    check 'Canary live policy refusal' check_guard_transcript "$OUT/canary.jsonl"
    check 'Canary commits nothing' canary_no_commit
}
work_run() {
    if ! NO_COLOR=1 bd -C /work/bob create --title 'Add a Node echo script' --type task --labels asset:tool \
        --body-file "$TEST_ROOT/fixtures/issue.md" --json >"$OUT/issue-created.json"; then
        cat "$OUT/issue-created.json"
        return 1
    fi
    issue_id=$(node -e 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1]));const id=value.id; if(typeof id!=="string" || !/^[A-Za-z0-9-]+$/.test(id)) process.exit(1); console.log(id)' "$OUT/issue-created.json") || return 1
    printf '/work %s via-merge\n' "$issue_id" >"$OUT/work-prompt.txt"
    check 'Work run completes within limits' agent_command work /work/bob "$OUT/work-prompt.txt" "$OUT/work-run.jsonl"
    check 'main contains echo.mjs' sh -c 'git -C /work/bob show main:echo.mjs >"$1/echo-main.mjs"' sh "$OUT"
    check 'Work run echo behavior on main' mise -C /work/bob exec -- node "$TEST_ROOT/checks.mjs" echo "$OUT/echo-main.mjs"
    check 'read Work run issue status' sh -c 'NO_COLOR=1 bd -C /work/bob show "$1" --json >"$2/issue-final.json"' sh "$issue_id" "$OUT"
    check 'Work run closed issue and merged agent work, with origin unchanged' check_work_evidence /work/bob "$OUT/issue-final.json" "$DEPLOY_COMMIT" /work/origin.git
    check 'Work run final gates succeeded' check_gates_transcript "$OUT/work-run.jsonl"
    check 'Work run used no hook bypass' check_bypasses "$OUT/work-run.jsonl" "$TEST_ROOT/bypass-patterns.txt"
}
step 1 Deploy deploy
DEPLOY_COMMIT=$(git --git-dir=/work/origin.git rev-parse main) || exit 1
printf 'Deploy commit: %s\n' "$DEPLOY_COMMIT" >>"$OUT/versions.txt"
step 2 Structure structure
step 3 Bootstrap bootstrap
step 4 Gates gates
step 5 Guards guards
if [ "$AGENT_SKIP" = 1 ]; then
    printf 'SKIP 6 Canary: no model credential\nSKIP 7 Work-run: no model credential\n' >>"$RESULTS"
    if [ "${TEMPLATE_TEST_REQUIRE_AGENT:-0}" = 1 ]; then
        printf 'FAIL -RequireAgent: model credential required\n' >>"$RESULTS"
        exit 1
    fi
else
    step 6 Canary canary
    step 7 Work-run work_run
fi
VERDICT=PASS
