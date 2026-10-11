# The Template test: a plan

**The Template test deploys the Template into a new, empty git repository inside a container. It
checks that the Target project it makes works on a second machine: Bootstrap succeeds, the gates
pass, and the guards are live. Then an agent writes a small Node script there twice, once from a
bare prompt and once through the harness's own issue-to-merge workflow. The test's main subject is
Deploy, which does not exist yet. This plan states what the test requires of Deploy, and the deploy
work builds to that.**

## Terms

This plan uses the terms in `CONTEXT.md`: Template, Target project, Pluggable component, Deploy,
Bootstrap, Tracker, Template test, Canary and Work run. Where this plan and `CONTEXT.md` disagree on
a term, `CONTEXT.md` wins. ADR 0001 (`docs/adr/0001-deploy-creates-tracker-bootstrap-hydrates.md`)
records why Deploy creates the Tracker and Bootstrap only hydrates it.

Two names are local to this plan:

- **Alice's clone** is the repository Deploy runs in, the one a project's creator would have.
- **Bob's clone** is a fresh clone of origin made after Deploy, the one the next machine would have.

## What the test is for

A Target project is only as good as what its remote gives the next machine. The Template test
answers one question: does Deploy produce a Target project that a fresh machine can bootstrap, whose
gates pass and whose guards refuse what they should, and where an agent can do a small piece of work
through the harness?

It runs by hand for now. Every step before the agent steps needs no secret, so those steps can join
CI later without a redesign. The agent steps need a model credential and cost money, so they stay
opt-in.

No Pluggable component is deployed yet. The Deploy contract below leaves room for them.

## Where it runs

- **The image** is built from `template/.devcontainer/Dockerfile`, with `template/` as its context,
  as the Template's own build does. A run therefore also proves the image builds and holds the
  toolchain: mise, Node, bd, gh and Claude Code. The image tag is fixed, so a run reuses the cached
  image. `-NoCache` rebuilds it, which also picks up a newer Claude Code, since the Dockerfile leaves
  Claude Code unpinned.
- **The container** starts with its entrypoint bypassed. The Bootstrap step runs the entrypoint
  deliberately, against Bob's clone.
- **The Template under test** is the asdlc-starter working tree, mounted read-only at `/src`, so a
  change can be tested before it is committed. `-Ref <ref>` tests a named revision instead: the
  driver checks that ref out into a temporary detached worktree, and builds and mounts that.
- **Claude Code** gets a fresh, empty `CLAUDE_CONFIG_DIR`, and `DISABLE_AUTOUPDATER=1`. A host
  `~/.claude` would bring in personal skills, plugins and instructions that could hide a Template
  defect.
- **The environment** sets `MISE_TRUSTED_CONFIG_PATHS` to the Template and the clones under
  `/work`, and points `REPO_WORKSPACE` and `GITHUB_APP_WORKSPACE` at Bob's clone for the Bootstrap
  step. These are the variables `devcontainer.json` sets today. So if `devcontainer.json` goes, the
  driver's `docker run` line already shows what replaces it.
- **The network** is needed: the image build, npm, and the model's API. GitHub is not used at all.
  The only remote is a bare repository inside the container.

`devcontainer.json` is not exercised. The test never reads it, so removing it changes nothing here.

## What the Template test requires of Deploy

This section is the one home of Deploy's contract. The deploy plan cites it as its acceptance
criteria and changes it by editing it here, rather than restating it. Until that plan exists, this
section is a draft.

### How it is invoked

- `node <deploy> --values <file> <target-dir>`. It exits 0 on success and non-zero on any refusal,
  naming the reason.
- It runs on Node and imports nothing from `node_modules`, because it runs before any package
  install. Node is the runtime every Target project already needs, and the image has it through
  mise.
- It deploys the Template from the asdlc-starter checkout it lives in.
- The test finds it through `TEMPLATE_TEST_DEPLOY`. The default is the path the deploy plan
  chooses. Until then, the variable is required, and its absence fails the Deploy step with "Deploy
  not found".

### What it takes

- **A values file**, in JSON, with one key per placeholder name. Every placeholder in the Template
  carries its name, in the form `<REPLACE_ME:name>`. Today's bare `<REPLACE_ME>` stands for
  different values in different files, so a values file cannot fill it. Work item 5 converts them.
- **Required values** are the project name, the GitHub owner and repository, and the GitHub App's
  identity (app id, installation id, bot login and bot user id). The Template assumes the App
  everywhere: the entrypoint, the `gh` wrapper, the credential helper and the token's selftest. So
  the App is required, and the test's fixture gives dummy values.
- **The Tracker's remote** defaults to origin's URL, since the Tracker lives on the git remote. The
  values file can set it.
- **A target** that is a git repository with no commits and an `origin` remote.
- **No Pluggable components yet.** When they arrive, they are another input to Deploy, and this
  section gains their postconditions.

### What it leaves behind

The Structure step checks each of these:

1. Origin's `main` holds exactly one commit, and Alice's `main` is that commit.
2. That commit's tree is the Template's tracked files: `git ls-files template/` at the revision
   under test, with their working-tree contents, at the same paths relative to `template/` and with
   the same file modes. Each file is byte-identical, except that every `<REPLACE_ME:name>` is replaced
   by the value of `name`. The tree also holds exactly the files that creating the Tracker adds. A
   probe lists those files (work item 1), and this section then names them, along with any Template
   file that creating the Tracker edits.
3. No `<REPLACE_ME` remains anywhere in that tree.
4. Origin holds the Tracker. The ref bd uses for it is to be confirmed by a probe.
5. Alice's clone has a clean working tree.

A file that is not tracked is not deployed. A new Template file is deployed only after `git add`,
which is also how the citations gate behaves.

### What it refuses

The Template test does not exercise Deploy's refusals: Deploy's own selftest covers them, in the
deploy plan. They are listed here so that selftest has a spec:

- a target that is not a git repository, has a commit, or has no `origin`;
- a values file that lacks a name the Template uses, names one it does not use, or gives an empty
  value;
- a push to origin that fails.

Whether a refused Deploy undoes what it had done is the deploy plan's call.

## The steps

A run is an ordered list of steps. It stops at the first step that fails. Within a step every check
runs, so one run shows all of that step's failures. The **agent steps** are the Canary and the Work
run: they need a credential, and are skipped without one.

| # | Step | Where | Passes when |
|---|---|---|---|
| 1 | Deploy | Alice's clone | Deploy exits 0 |
| 2 | Structure | origin and Alice's clone | every postcondition of the contract holds |
| 3 | Bootstrap | Bob's clone | the Template's Bootstrap route made what it should, and warned only as expected |
| 4 | Gates | Bob's clone | CI's steps and the full pre-push suite pass; a bad push is refused, and a good one lands |
| 5 | Guards | Bob's clone | each hook refuses its bad payload and allows its good one |
| 6 | Canary | a copy of Bob's clone | the echo test passes, and a guard refused in a live session |
| 7 | Work run | Bob's clone | the echo test passes on `main`, and the workflow left its evidence |

### 1. Deploy

The test sets a fixed git identity, `Template Test <template-test@example.invalid>`. It makes a bare
origin at `/work/origin.git` and an empty repository at `/work/alice` with that origin. Then it runs
Deploy with `tests/template/fixtures/values.json`.

### 2. Structure

The test re-derives the expected tree from the Template and the values file. It diffs that tree
against origin's `main`, path by path, mode by mode and byte by byte, and checks the contract's other
postconditions. The re-derivation is a plain substitution of named placeholders, so it does not
reimplement Deploy.

### 3. Bootstrap

The test clones origin into `/work/bob`. It then runs the Template's own Bootstrap route there. Today
that route is the entrypoint, run as `workspace-entrypoint true` with `REPO_WORKSPACE` set. When the
skill-management plan's bootstrap script lands, the step runs that script instead. The test keeps no
copy of the Bootstrap steps, because a copy would drift from the Template.

The entrypoint only warns and never fails, so the test checks what it made:

- `node_modules/.devcontainer-lock-hash` equals the hash of `package-lock.json`;
- the clone's config holds the five `hook.asdlc-*` command entries;
- `.beads/embeddeddolt` exists, and bd reads it;
- every warning in the entrypoint's log is on `tests/template/expected-warnings.txt`. Each line of
  that file gives its reason. Today the list holds one warning: the GitHub App cannot mint a token,
  because no key is mounted. The git identity is set before the step runs, so the entrypoint's
  `commit_identity` leaves it alone and does not warn.

### 4. Gates

In Bob's clone:

1. Every `mise run` step of the deployed `.github/workflows/verify.yml`, in order. The test reads
   them from that file, so CI's list of steps has one home.
2. `mise run gates`, the full pre-push suite.
3. A commit that adds a Markdown file with a dangling `§` citation, pushed to `template-test/probe`
   on origin. The push must be refused, because the `citations` pre-push job has no glob and runs on
   every push. This proves the installed hooks run, rather than being skipped without a word.
4. The bad commit is dropped. An empty commit is made and pushed to the same branch, and must land.

The probe branch keeps origin's `main` at the Deploy commit, which the Work run cuts its worktree
from.

### 5. Guards

A hook whose `node` cannot start exits with a code other than 2. Claude Code reads that as a
non-blocking error and runs the tool call unguarded. So the test runs every hook command in
`.claude/settings.json` exactly as written, through `sh -c`, with `CLAUDE_PROJECT_DIR` set to Bob's
clone. It feeds each one a payload it must refuse and a payload it must allow. A guard refuses by
exiting 2, with its reason on stderr. `guard-git.mjs`'s reason starts `BLOCKED by repository
policy:`, and the other guards word theirs differently. A provisioning hook fails by exiting
non-zero.

| Hook | Must refuse | Must allow |
|---|---|---|
| `guard-git.mjs` | Bash `gh pr create --title probe --body probe`, which it refuses in every checkout | Bash `git status` |
| `guard-unprovisioned-worktree.mjs` | Bash `git status`, run from a linked worktree whose branch does not start with `agent/` | the same command from the primary checkout |
| `block-generated-edit.mjs` | a Write of `probe.mjs` whose first line says it is generated and not to be edited by hand | a Write of `echo.mjs` with plain content |
| `worktree-create.mjs` | a `name` of two path segments: it must exit non-zero and make no worktree | `name: "probe"`: it prints a worktree path, on branch `agent/probe` |
| `worktree-remove.mjs` | a payload its header says it refuses (a probe confirms which) | the worktree made above: afterwards it is gone |

The payloads live in `tests/template/fixtures/hook-payloads/`, one pair per hook script. A hook in
`settings.json` with no pair fails the step with "no fixture for `<command>`", so a hook added later
cannot go unchecked.

### 6. Canary

The test copies Bob's clone to `/work/canary`, so the Canary starts from a clone that has already
passed Bootstrap, Gates and Guards, and Bob's clone stays clean for the Work run. It runs `claude -p`
there with the prompt in `tests/template/prompts/canary.md`. The prompt asks the agent to:

- write `echo.mjs` at the repository root, to the spec of the echo test below;
- run `gh pr create --title probe --body probe` once, and report what happened;
- commit nothing.

The step passes when the echo test passes on `/work/canary/echo.mjs`, and the transcript shows a Bash
call to `gh pr create` whose result carries `BLOCKED by repository policy`. That second check proves
Claude Code loads `settings.json` and honours a refusal. The Guards step cannot prove that, because
it runs the hooks itself.

A Canary pass followed by a Work run failure points at the harness, not at Claude Code, the
credential or the image.

### 7. Work run

The test files one issue in Bob's Tracker with bd: title "Add a Node echo script", type `task`,
label `asset:product`, and a body from `tests/template/fixtures/issue.md` whose
`## Acceptance Criteria` are the echo test's spec. `beads:check` asks for a type that
`policy/vocabulary.json` lists, so a wrong one would fail the gates for a reason that has nothing to
do with the agent. Then the test runs `claude -p "/work <id> via-merge"` in Bob's clone. The
`via-pr` route needs GitHub, so it is not used.

The step passes when every one of these holds:

- the echo test passes on `echo.mjs` as `main` holds it, read with `git show main:echo.mjs`;
- `bd show <id>` reports the issue closed, with a reason naming a commit that `main` reaches;
- some `agent/*` branch is an ancestor of `main`, and `main` has moved past the Deploy commit;
- the transcript's last Bash call to `mise run gates` succeeded;
- no Bash command in the transcript matches a pattern in `tests/template/bypass-patterns.txt`. Each
  line of that file gives its reason. The patterns are `--no-verify`, `GIT_HOOKS_SKIP`,
  `core.hooksPath`, `-c hook.` and `git commit` with `-n`. A refused commit is exactly what would
  tempt an agent to skip the hooks;
- origin's `main` is still the Deploy commit, because `via-merge` merges into local `main` and does
  not push it.

## The agent steps

- **Credential.** `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, passed into the container by
  name, and never written into the image or the run's output. With neither set, both agent steps
  are skipped.
- **Model.** `claude-sonnet-5-5`, which `TEMPLATE_TEST_MODEL` overrides. The test checks the
  harness, not the model.
- **Permissions.** `--permission-mode bypassPermissions`. The Template's settings grant no
  permissions, the container is thrown away, and PreToolUse hooks still run in this mode (a probe
  confirms that).
- **Output.** `--output-format stream-json --verbose`, saved as the run's transcript.
- **Limits.**

  | Run | Time | Turns |
  |---|---|---|
  | Canary | 5 min | 15 |
  | Work run | 30 min | 100 |

  A spend cap is added too, if the CLI offers one (a probe confirms whether it does). Each limit has
  an override variable. A run that hits a limit fails with the reason "budget", not "wrong answer".

### The echo test

Both agent steps use the same check:

| Command | Must print | Exit code |
|---|---|---|
| `node echo.mjs hello world` | `hello world` and a newline | 0 |
| `node echo.mjs "a  b" c` | `a  b c` and a newline | 0 |
| `node echo.mjs` | a newline | 0 |

A missing `echo.mjs` fails with that reason. Node comes from the Target project's own `mise.toml`
pin.

## What a run leaves behind

The driver mounts `tests/template/out/<run-id>/`, which is gitignored. The run id is the UTC time and
the asdlc-starter commit. The directory holds:

| File | What it holds |
|---|---|
| `summary.txt` | the verdict first, then one line per step and check: pass, fail or skip, with the reason. When the agent steps were skipped, a banner says so before anything else |
| `steps/<n>-<step>.log` | each step's full output |
| `canary.jsonl`, `work-run.jsonl` | the agent steps' transcripts |
| `versions.txt` | the asdlc-starter commit and whether the tree was dirty, the image id, the model, and the versions of Claude Code, Node, bd, gh, git and mise |
| `target.bundle`, `origin.bundle` | Bob's clone and the origin, with every ref, for inspecting a failure afterwards |

The driver exits 0 when every step that ran passed, including a run whose agent steps were skipped.
It exits non-zero on any failure, and when Docker cannot be reached. In that case it says to start
Rancher Desktop. `-RequireAgent` turns a skipped agent step into a failure, for signing off a
Template change.

## The harness

| File | What it is |
|---|---|
| `tests/template/run.ps1` | the host driver: checks Docker, builds the image, makes the run directory, runs the container. Its switches are `-Ref`, `-RequireAgent`, `-NoCache` and `-Selftest` |
| `tests/template/steps.sh` | the steps, in POSIX `sh`, run inside the container |
| `tests/template/checks.sh` | the pure checks the steps call, sourced by `steps.sh` and `selftest.sh` |
| `tests/template/selftest.sh` | the checks, negative-tested over fixtures |
| `tests/template/fixtures/` | the values file, the Work run's issue body, and the Guards payloads |
| `tests/template/prompts/canary.md` | the Canary's prompt |
| `tests/template/expected-warnings.txt` | the Bootstrap step's allowed warnings, each with its reason |
| `tests/template/bypass-patterns.txt` | the hook bypasses the Work run must not use, each with its reason |
| `tests/template/README.md` | what each file is, and how to run the test |

The driver is pwsh. The script inside the container is POSIX `sh`, because the image has no pwsh,
and a bare `node` fails there until a trusted `mise.toml` sits above the working directory.

### The selftest

`run.ps1 -Selftest` runs `selftest.sh` in the image, with no Deploy and no model, in seconds. Each
case breaks exactly one thing and asserts that the check fails for that reason. One untouched control
case must pass. The cases cover:

- **The echo test:** a wrong join, a missing newline, a non-zero exit, and a missing file.
- **The Structure checks:** a file missing, a file extra, a byte changed, a mode changed, and a
  placeholder left in.
- **The transcript scans:**
  - the guard's refusal absent;
  - each bypass pattern present;
  - the gates call missing, and the gates call failed.
- **The Bootstrap warning list:** an unexpected warning.
- **The Guards fixture coverage:** a hook in `settings.json` with no fixture pair.

## What has to be true before it can pass

Run today, the test fails, and it should. The test tolerates none of these failures. Each fix is its
own work item:

1. **`mise.lock` is missing.** The Dockerfile copies it and installs with `--locked`, so the image
   cannot build. It needs linux-x64 and linux-arm64, since the image builds for the host's
   architecture, plus every platform `mise.toml`'s header says the project runs on.
2. **`package-lock.json` is missing,** so `npm ci` fails in the entrypoint and in `verify.yml`.
3. **A plain `git commit` is refused once the hooks are installed.** `git-hooks.yml` has no
   `pre-commit:` block, and `scripts/git-hooks.mjs` refuses a gating event with no block.
   `AGENTS.md` § "The gate ladder" describes a pre-commit tier that does not exist.
4. **`citations:check` fails.** `.beads/PRIME.md`, `.claude/agents/fan-out-work.md`,
   `policy/vocabulary.json` and `policy/prompt-budgets.json` name `.claude/skills/bead/SKILL.md`,
   which does not exist.
5. **Project-specific values are hard-coded,** and those that are placeholders carry no name:
   - `package.json`'s `name`;
   - in `policy/tool-settings.json`, an existing GitHub App's id, installation id, bot login and bot
     user id, beside the two `<REPLACE_ME>` keys;
   - `.beads/config.yaml`'s `sync.remote`;
   - in `devcontainer.json`, `workspaceFolder` and the `~/.asdlc-agent-j` key mount. This item also
     settles whether `devcontainer.json` stays at all.
6. **`AGENTS.md` § "Memory tiers"** still reads `*thing*` and `*thing2*`.
7. **Five `.DS_Store` files are tracked** under `template/`.

One more question belongs to the Template, not to this test. `policy/vocabulary.json` says a change
to what the product does is filed as an epic, with tasks under it. Read strictly, that makes the Work
run's one-file echo script an epic. The test files a `task`, which `beads:check` accepts, and leaves
the vocabulary to its owners.

## Facts to probe first

None of these has been confirmed by a run. Each one shapes a check above. They run in the image with
a throwaway config directory, and the findings are recorded in this plan.

- PreToolUse hooks run under `--permission-mode bypassPermissions`, and an exit 2 there blocks the
  call.
- Whether `claude -p` offers a spend cap, and whether it honours `--max-turns`.
- `claude -p "/work <id> via-merge"` invokes the project's skill, and `EnterWorktree` and the
  `WorktreeCreate` hook work in print mode.
- `CLAUDE_CODE_OAUTH_TOKEN` alone authenticates `claude -p` with an empty config directory.
- How `stream-json` records a Bash call and a hook's refusal, so the transcript scans read the right
  fields.
- What `bd init --skip-agents --skip-hooks` writes into `.beads/` with bd 1.3.0, the pinned version.
  Those flags were read from 1.3.1's help. Also whether it edits a Template file.
- Whether bd's Dolt remote works against a local bare repository, both for the push at Deploy and for
  `bd bootstrap`, and which ref it uses.
- Whether `MISE_TRUSTED_CONFIG_PATHS` trusts the directories under a path, so a worktree under
  `.claude/worktrees/` resolves `node`.
- Whether a copy of a clone with an embedded Dolt database still works, or holds absolute paths.
- Which payload `worktree-remove.mjs` refuses.

## What this plan leaves alone

- `devcontainer.json`, which may go.
- GitHub: the entrypoint's first-start clone, minting a real App token, `git` and `gh` acting as the
  App, the `via-pr` route and the `open-pr` skill, the Tracker syncing to GitHub, and `verify.yml`
  running on GitHub.
- Building a Target project's own image from its deployed files. The test builds from the Template.
- Bootstrap on a host outside the container, on any platform.
- Deploy's refusals, which belong to Deploy's own selftest.
- Pluggable components.
- Wiring the test into CI.
- Whether the Template's prompts and skills are any good, beyond whether they let the work through.

## Decisions, and what each gives up

- **The steps split by whether they need a secret,** and a run with the agent steps skipped exits 0.
  It gives up this: a careless reader can take a skipped run for a full pass. The summary's banner
  and `-RequireAgent` are the guards.
- **Deploy's contract lives in this plan.** It gives up this: the deploy plan cannot restate the
  contract, and has to cite this section and edit it here.
- **Deploy creates the Tracker, and Bootstrap only hydrates it** (ADR 0001). It gives up this: Deploy
  needs an origin it can push to.
- **The image is built from the Template's own Dockerfile.** It gives up two things.
  `devcontainer.json` goes untested. And the image is built from the Template rather than the Target
  project's deployed files, which differ only in the copy of `policy/tool-settings.json` the image
  holds.
- **The lockfiles are committed in the Template.** It gives up this: a Target project starts on the
  Template's pins, not the latest.
- **The model is pinned to Sonnet, and the agent runs with bypassed permissions and an empty
  config.** It gives up the model, the permission prompts and the allow rules a real user would have.
  The Template ships no permissions to test.
- **The test tolerates no known defect.** It gives up a green run until every item in § "What has to
  be true before it can pass" lands.
- **The Bootstrap step runs the Template's own route and checks what it made.** It gives up a plain
  exit code: the test reads the entrypoint's warnings, so a reworded warning breaks the list.
- **The steps after Structure run in Bob's fresh clone.** It gives up a few minutes for a second
  clone and a second `npm ci`.
- **A Canary runs before the Work run.** It gives up a second model run's time and cost, for a
  failure that says which side is at fault.
- **The echo script is Node.** It gives up exercising a change to the toolchain, which a Python
  script would have needed.
- **The Gates probe pushes to a branch, and the Canary runs in a copy of Bob's clone.** These give up
  a push to `main` from the primary checkout, which no guard refuses anyway, and a Canary
  independent of Bob's Bootstrap, which has passed by then.

## Work items

Each item is one issue. The last column names the items that must land first.

| # | Item | Lands in | After |
|---|---|---|---|
| 1 | The probes in § "Facts to probe first", with their findings written into this plan | this plan | none |
| 2 | Commit `mise.lock` and `package-lock.json` | `template/` | none |
| 3 | Make a plain commit pass, and make `AGENTS.md` § "The gate ladder" true | `template/git-hooks.yml` or `template/scripts/git-hooks.mjs`, `template/AGENTS.md` | none |
| 4 | Resolve the references to the `bead` skill | `template/` | none |
| 5 | Name every placeholder, turn the hard-coded identifiers into placeholders, and decide on `devcontainer.json` | `template/` | none |
| 6 | Fill or drop `*thing*` and `*thing2*` | `template/AGENTS.md` | none |
| 7 | Remove the tracked `.DS_Store` files, and ignore them | `template/`, `.gitignore` | none |
| 8 | Deploy, to § "What the Template test requires of Deploy", with its own selftest of the refusals | a deploy plan, then the path it chooses | 1, 5 |
| 9 | The harness up to the Guards step: driver, steps 1 to 5, checks, selftest and fixtures | `tests/template/`, `.gitignore` | 1 |
| 10 | The agent steps: the Canary, the Work run, the prompt, the issue fixture and the transcript scans | `tests/template/` | 1, 9 |
| 11 | The first green run, with its `summary.txt` attached to the issue | none | 2 to 10 |

The harness can land before Deploy does. Until then it fails at step 1 with "Deploy not found",
which is the right answer.
