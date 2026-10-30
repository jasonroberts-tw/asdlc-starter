# ASDLC Starter

This repository maintains the Template, an agentic software development lifecycle (SDLC) harness
that Deploy puts into new Target projects. The Template keeps shared skills, agent prompts, and hook
declarations in [template/.harness](template/.harness/README.md). Command-line interface (CLI)
adapters render the integrations selected for a Target project.

## What the Template provides

Each entry says why a capability exists, which is the failure it stops when agents do real work in
a project. The file that implements a capability opens with a header naming that failure. Where the
header and this list disagree, the header wins.

### A delivery workflow with human gates

Every change moves on one of four tracks: feature, defect, small change or harness task. A feature
passes through five skills in order: `refine`, `design`, `plan-stories`, `work` and
`review-feature`. The operator confirms the feature's intent at Gate 1 and approves its design at
Gate 2. No implementation code is written before Gate 2, because code built on an unapproved design
is rebuilt when the design moves. The other three tracks go straight to `work`, so a bug fix or a
refactor does not pay for steps it does not need.

### Specs that stay tied to their tests

Each feature has one Markdown spec under `docs/specs/`, holding numbered acceptance criteria and a
test plan. `check-trace.mjs` reports each criterion that no story builds or no test checks. Without
that check, a feature with a gap would pass review, because the reviewer reads the stories rather
than the spec. A test written from a spec's test plan is protected from the commit that adds it, and
so is a test that reproduces a defect. The edit hook refuses an edit to a protected test, because a
test changed until it passes proves nothing. Only the operator changes one, in a commit of their
own.

### Review in a fresh context

The `spec-reviewer` agent checks a change against its spec without seeing the implementing session's
transcript. A reviewer who reads the implementer's reasoning inherits its blind spots. The agent
checks traceability, contracts, protected tests, fitness functions, and a mutation score of at
least 80%. The operator decides each gap it reports. Before a branch is pushed, the
`adversarial-verifier` agent tries to falsify each claim in the branch by re-deriving it from
source. `AGENTS.md` also makes every agent re-derive any figure it states and cite where it came
from, because a count taken from memory or an issue title is often stale.

### Skills for diagnosis and adoption

The `root-cause` skill makes an agent reproduce a failure and find its cause before changing
anything. A fix aimed at a guess can turn a check green and leave the cause in place. The skill
stops the agent after a set number of failed fixes, so the agent reports back instead of piling up
guesses. The `should-i-adopt` skill assesses a proposed tool or practice against the project's
rules, with trials in Docker. It asks for the problem first, because a candidate that solves no
named problem is all cost. It ends with a proposed decision record, because adopting is a person's
choice.

### Isolated worktrees for parallel agents

Each agent task gets its own git worktree, on an `agent/<issue id>-<slug>` branch cut from
`origin/main`. `new-worktree.sh` also reserves a pair of ports for the worktree and writes a
briefing to `.worktree/CONTEXT.md`. The briefing tells the agent that other agents are editing the
repository at the same time. So the agent prefers additive changes, and it stops on a rebase
conflict it did not expect. The `fan-out-work` agent splits the ready queue into lanes by the files
each issue touches, so two lanes never rewrite the same lines. Before it pushes, the `open-pr` skill
test-merges the branch against each open pull request that touches the same files. It then watches
the checks, fixes a failing one a bounded number of times, waits for a person's approval and the merge,
and removes the worktree after the merge.

### Guards that hold when a prompt is forgotten

A prompt is advice, so in-session hooks enforce the rules that matter most. Worktrees share one
object store and one trunk, which means a `git gc` or a push to `main` from one worktree lands on
work its agent cannot see. `guard-git.mjs` refuses those commands in a worktree. It also refuses a
`gh pr create` that does not name `main` as its base, because GitHub's default branch is a setting
the repository cannot read. `guard-unprovisioned-worktree.mjs` refuses work in a worktree the script
did not make, because that worktree has no briefing. `block-generated-edit.mjs` refuses hand edits
to generated files, because the generator's next run silently reverts them. `guard-delivery.mjs`
enforces protected tests and Gate 2. `AGENTS.md` tells an agent not to retry a refused command in
another form, because each workaround gets past a judgement the session cannot overrule.

### The same checks at four speeds

Gates run at four tiers: in-session hooks in milliseconds, pre-commit in seconds, pre-push in tens
of seconds, and continuous integration (CI) in minutes. The fast tiers give an agent feedback while
the change is still cheap to fix. A slower tier never trusts a faster one, and CI binds every pull
request and every push to `main`. A pre-push job can be scoped by a glob of the files it reads, so a
push skips the gates its change could not break. Every gate has a selftest that breaks one thing per
case and checks that the gate fails for that reason. Without a selftest, a gate can lose a rule and
still pass. Every gate's header names the failure it prevents, because a gate whose header says only
what it checks is the one the next person weakens to get a push through.

### Secret and dependency scanning

The secrets gate runs Betterleaks over commits rather than over the working tree. A token committed
and then deleted in the next commit still reaches origin in the history, where anyone who can clone
reads it until it is revoked. The dependency gate runs osv-scanner over every tracked lockfile,
against the osv.dev advisory database. osv-scanner reads Python, Go and other ecosystems' lockfiles,
whereas `npm audit` reads only `package-lock.json`. Both gates run at pre-push and in CI. A private
GitHub repository gets neither check from GitHub without Advanced Security, and GitHub's checks do
not run before a push. Decision records [0003](docs/adr/0003-scan-secrets-and-dependencies.md)
and [0004](docs/adr/0004-scan-secrets-with-betterleaks.md) explain the choice of tools.

### A shared Tracker for all work

Every task is an issue in the Tracker, a beads (`bd`) database shared through origin. `bd ready` is
the one queue, so work does not scatter across Markdown checklists and session to-do lists. Deploy
creates the Tracker once, and Bootstrap only hydrates it on each machine. If Bootstrap created a
Tracker whenever it found none, two machines that Bootstrap a new project would each create one, and
the two would diverge. An agent that finds a problem mid-task files it with labels for the kinds of
file it would change. A repeat finding raises a count label on the existing issue instead of filing
a second one, so the Tracker shows how often a cost recurs.

### Bootstrap and the doctor

`mise run bootstrap` brings a machine to a working state in one command. It installs the tools
pinned in `mise.toml`, runs `npm ci` when the lockfile changed, installs the git hooks, hydrates the
Tracker and syncs outside skills. Each step checks first, so a second run is cheap. Bootstrap ends
with the doctor, which probes the machine without changing it and names the fix for each problem it
finds. Without the doctor, a Bootstrap step skipped on one machine fails later, mid-task, with an
error that does not name the step. Every tool is pinned in `mise.toml` and `mise.lock`, so every
machine and CI run the same versions.

### A dev container that acts as a GitHub App

The dev container makes its own clone, installs the same pinned tools and runs Bootstrap at every
start. Inside the container, `git` and `gh` use a GitHub App token scoped to the one repository. So
an agent's commits and pull requests carry the App's bot identity rather than the operator's
account. The token is replaced before its hour runs out, so a long session does not lose push access
partway through. The credential helper answers only for github.com, so the token never reaches
another host. A Target project Deployed without an App still gets the container, but its work is
pushed from the host.

### One harness source for Claude Code, Codex, GitHub Copilot and OpenCode

Skills, agents and hook declarations live once, under `.harness/`. `render-integrations.mjs` renders
them into each tool's native format. Claude Code gets `.claude/`. Codex gets `.codex/` with
`.agents/skills/`. GitHub Copilot gets `.github/skills/`, `.github/agents/` and
`.github/hooks/harness.json`, which both Copilot CLI and Copilot in VS Code read. OpenCode gets
`.opencode/skills/`, `.opencode/agents/` and, for OpenCode 1 and OpenCode 2 each, a plugin that runs
the same hook scripts. A team can use any of the tools, or several, without keeping copies of the
rules that drift apart. The renderer records which files it owns. It refuses to overwrite a local
edit to a generated file, so rendering cannot silently discard someone's change. Its `--check` flag
reports drift without writing.

### Rules with one home, and constants with their reasons

Each rule an agent follows lives in exactly one tracked file: `AGENTS.md`, a skill, an agent
definition, or the header of the gate that enforces it. A rule with two homes has one that is stale.
Every constant a prompt or a tool reads lives under a key in `policy/`, with a sibling field saying
what the value decides. `check:policy` refuses a constant without that field, and a key that two
records define. Each prompt has a word budget in `policy/prompt-budgets.json`, because every session
pays for every word, and prompts grow one reasonable sentence at a time. `citations:check` fails
when a `file.md § "Heading"` pointer stops resolving, because a renamed heading leaves pointers that
still look authoritative.

### Outside skills, admitted behind checks

Good skills are published outside the project, and the only other way to use one is to keep an
adapted copy up to date by hand. That is why a Target project can load Claude Code plugins and
published skills that `policy/skill-sources.json` pins. An admitted skill loads word for word into
every session on every machine, and nobody in the project can edit it. So the `add-skill` skill
admits one only at a full commit, and only after three checks: a scan of its commands, a read by
the read-only `skill-assessor` agent against the project's rules, and the skills.sh security audit.
The operator decides each finding. Each sync re-reads the audit and removes a skill whose audit gets
worse.

## Deploy, test and render

Deploy the Template, substitute project values, create its Tracker, and publish its initial commit
to an empty origin:

```sh
node scripts/deploy.mjs --values values.json ../target-project
```

To have an agent walk you through it, including the GitHub repository and App, point it at
[INSTALL.md](INSTALL.md).

The Target must be an empty git repository with an empty `origin`. Deploy needs Node, git, a git
identity, and the Template's pinned bd. It installs no npm packages. Add
`--integrations codex`, `--integrations copilot`, `--integrations opencode` or a list such as
`--integrations claude,copilot`
to select the integrations; Claude is the default. See [Deploy's contract](plans/template-test-plan.md#what-the-template-test-requires-of-deploy)
for the values file and [implementation notes](plans/deploy-plan.md) for failure handling.

Run the complete container test or its credential-free negative controls with PowerShell:

```powershell
pwsh -NoProfile -File tests/template/run.ps1
pwsh -NoProfile -File tests/template/run.ps1 -Selftest
```

The test builds the Template image, deploys to Alice, clones into Bob, runs Bootstrap, CI gates and
guard probes, then runs the Canary and issue-to-merge workflow when a model credential is set.
Without one, the summary explicitly skips both agent steps. Use `-RequireAgent` for a run that must
include them. [Test instructions](tests/template/README.md) cover credentials, limits, `-Ref`,
`-NoCache`, and saved artifacts. [The test plan](plans/template-test-plan.md) defines acceptance.

To render integrations for an existing project that already has the common Template files:

```sh
node template/scripts/render-integrations.mjs --integrations claude ../target-project
node template/scripts/render-integrations.mjs --integrations codex ../target-project
node template/scripts/render-integrations.mjs --integrations claude,codex ../target-project
node template/scripts/render-integrations.mjs --integrations claude,copilot ../target-project
node template/scripts/render-integrations.mjs --integrations opencode ../target-project
```

Choose one command. Claude is the default when `--integrations` is omitted. The Target directory
must already exist. The renderer writes integration files and an ownership manifest, preserves
conflicting local files, and supports `--check` with the same selection to verify output without
writing. From a deployed Target project, invoke `node scripts/render-integrations.mjs` instead.

Codex uses `.codex/` for configuration and agents, and `.agents/skills/` for skill discovery.
GitHub Copilot uses `.github/skills/`, `.github/agents/` and `.github/hooks/harness.json`, in Copilot
CLI and in VS Code, and reads `AGENTS.md` itself. OpenCode uses `.opencode/skills/` and
`.opencode/agents/`, and reads `AGENTS.md` itself. It runs no hook commands, so a plugin runs the
hook scripts before its tool calls: `.opencode/plugins/harness.js` in OpenCode 1, and
`.opencode/plugins/harness-v2/` in OpenCode 2. None of Codex, Copilot and OpenCode has a worktree
lifecycle hook, so the renderer reports those two hooks as unsupported, and their workflows run the
shared worktree script. See the
[source and format guide](template/.harness/README.md) for details.

Run the adapter tests with `mise run integrations:selftest` from `template/`, after installing the
Template's npm dependencies and trusting its mise configuration.
