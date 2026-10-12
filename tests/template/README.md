**The Template test proves a deployed project's remote can bootstrap a fresh clone and enforce its gates and guards.**

[The Template test plan](../../plans/template-test-plan.md) defines acceptance and wins if these
instructions disagree. The test controls live in this directory; the system under test is
[`scripts/deploy.mjs`](../../scripts/deploy.mjs) and the tracked `template/` source.

| File | Role |
|---|---|
| `README.md` | Host commands, credentials, limits and saved artifacts |
| `run.ps1` | Checks Docker, builds the Template image, mounts a checkout or revision, and removes temporary worktrees |
| `driver.selftest.ps1` | Checks missing Docker and an unreachable daemon without contacting Docker |
| `steps.sh` | Runs Deploy, Structure, Bootstrap, Gates, Guards, Canary and Work run in order |
| `checks.sh` | POSIX shell entry points for the Node checks |
| `checks.mjs` | Byte/mode comparisons, Bootstrap checks, deployed CI execution, live guards and Work history evidence |
| `checks.selftest.mjs` | Positive and negative echo, tree, warning and hook-fixture controls |
| `transcripts.mjs` | Associates Bash calls with tool results, verifies completion and gates, and rejects hook bypasses |
| `transcripts.selftest.mjs` | Rejects absent, mismatched, failed or prose-only tool evidence and incomplete or limited runs |
| `agent.mjs` | Runs Claude with wall-time, turn and spend limits and redacts supplied credentials from output |
| `agent.selftest.mjs` | Real child-process controls for time limits and credential redaction |
| `work.selftest.mjs` | Real Git history controls for issue closure, merged agent work and an unchanged origin |
| `selftest.sh` | Runs the pure selftests without Deploy or a model |
| `fixtures/` | Dummy project values, pinned Tracker README, issue body and hook payloads |
| `prompts/canary.md` | Bare echo prompt plus one explicitly requested policy-refusal probe |
| `expected-warnings.txt` | Allowed Bootstrap warnings, each with a reason |
| `bypass-patterns.txt` | Refused Work-run Bash bypass patterns, each with a reason |
| `out/` | Gitignored run summaries, logs, transcripts, versions and all-ref bundles |

Run from the repository root with PowerShell and Docker. Start Rancher Desktop first if Docker
cannot be reached. Network access is required for the image build, npm and optional model calls.

```powershell
pwsh -NoProfile -File tests/template/run.ps1
pwsh -NoProfile -File tests/template/run.ps1 -Selftest
pwsh -NoProfile -File tests/template/driver.selftest.ps1
pwsh -NoProfile -File tests/template/run.ps1 -Ref HEAD
pwsh -NoProfile -File tests/template/run.ps1 -NoCache -RequireAgent
```

The default tests tracked paths using their working-tree bytes; stage a new Template file before
testing it. `-Ref` uses a temporary detached worktree and its read-only Git metadata. Its image and
Deploy source come from that revision; the current test controls are mounted separately at `/tests`.
`-NoCache` rebuilds the image without cache, including its unpinned Claude installation.
`-Selftest` runs the pure positive and negative controls in seconds, independently of Deploy.
Scratch Git tests ignore caller Git environment overrides and personal configuration, so commit
signing and hooks from the host cannot redirect or break their fixtures.

Agent steps run when `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is set in the host environment.
The driver passes these by name. It mounts no personal Claude configuration; the container creates
a fresh `CLAUDE_CONFIG_DIR`. With neither credential, the summary starts with an agent-skip banner
and succeeds if all executed checks pass. `-RequireAgent` makes that skip a failure.

The model defaults to `claude-sonnet-5-5`; set `TEMPLATE_TEST_MODEL` to override it. Limits are
defined in `agent.mjs` and documented in the plan. Override them with
`TEMPLATE_TEST_CANARY_SECONDS`, `TEMPLATE_TEST_CANARY_TURNS`, `TEMPLATE_TEST_CANARY_USD`, or the
corresponding `TEMPLATE_TEST_WORK_*` variables. Reaching a limit reports `budget`. Set
`TEMPLATE_TEST_DEPLOY` only to test a different Deploy entry point; it names a path inside the container.

Each normal run writes `out/<UTC-time>-<source-commit>/summary.txt`, `steps/` logs, `versions.txt`,
and `target.bundle` and `origin.bundle` containing every ref. Agent runs add transcripts and stderr
logs; Work run adds the created/final issue JSON and main's echo script. A failed step prevents later
steps from running, while checks within that step collect failures. The image id and source dirty
flag make the artifacts traceable. GitHub is never contacted by a test step.

The paid Canary and Work run require a real credential. Local simulated API probes verified CLI
hook, skill, transcript and limit behavior; they do not substitute for a paid `-RequireAgent` run.
