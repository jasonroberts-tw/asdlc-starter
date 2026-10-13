# Skill management for a Claude Code harness: a plan

**Two committed lists say which outside skills a repository wants. One lists plugins, and the other
lists skills that the `skills` CLI installs. A skill joins the second list only after two checks
have run, and a person has accepted each finding. A bootstrap command sets a machine up, and that
setup includes matching both lists. A doctor command says what is still wrong. Both commands run on
a person's own machine and in a dev container alike.**

## What the plan assumes

The plan fits a repository with the parts below. Where a part is missing, drop the steps that use it.

| Part | What the plan uses it for |
|---|---|
| Claude Code project settings, committed in `.claude/settings.json` | the plugin list |
| Tracked skills under `.claude/skills/` and agents under `.claude/agents/` | the skills and agents the repository writes itself |
| A committed JSON policy file that scripts read | the marketplace sources and the installed-skill table |
| A task runner that pins the toolchain | the bootstrap, doctor and sync tasks |
| Git hooks and a CI workflow | the checks over committed files |
| Protected paths, whose change needs a person's approval to merge | the two lists, the assessor and the scripts |
| A dev container with an entrypoint script | the container route |
| An issue tracker | the operator's decisions on findings |

"The host" below means a person's own machine. "The container" means the dev container. "The
operator" means the person who decides on a finding.

## Where a skill comes from

| Source | Declared in | How it reaches a session without this plan | What removes it without this plan |
|---|---|---|---|
| Tracked skill | `.claude/skills/<name>/SKILL.md` | the checkout | a commit that deletes it, then a pull |
| Plugin skill | `enabledPlugins` in `.claude/settings.json` | a marketplace registration and an install record | nothing |
| Skill from the `skills` CLI | nowhere | no route | no route |
| User-scope plugin the container enables | the container's entrypoint | the entrypoint, when the plugin's config file is present | the entrypoint, when that file is gone |

A tracked skill needs no install step. It arrives and leaves with the checkout. The skills page of
Claude Code's docs says a change to a skill directory loads mid-session (not verified). So the setup
work is in the second and third rows.

## What goes wrong without it

1. On the host, a plugin arrives only when a person runs the setup commands by hand. A person who
   skips them gets no plugin, and only `/plugin` says so.
2. Each marketplace's source is spelled in several files. These are the Dockerfile's
   `claude plugin marketplace add` lines, the entrypoint and the setup instructions. A change to one
   source has to reach all of them.
3. Dropping a plugin from `enabledPlugins` leaves its install record, its cache and its data
   directory on every machine. No step on any route uninstalls it.
4. No test runs the plugin setup.
5. No marketplace is pinned. Suppose a plugin ships from the same repository as a CLI that the
   toolchain pins. The CLI then stays at its pin, while the plugin follows whatever its marketplace
   serves.
6. A skill from the `skills` CLI has no route, and the obvious route breaks the repository's own
   checks on that machine. These are the steps:
   1. A project install writes `.claude/skills/<name>/`.
   2. A check that finds skills by reading that directory from disk treats the outside skill as one
      of the repository's own.
   3. The check refuses the outside skill, because the skill does not follow the repository's
      prompt rules.
   4. So the full check suite fails on that machine.

   A session hook that lints untracked files also reports the outside text's faults. Nothing
   ignores the directory in git, so the skill shows as an untracked file that someone could commit
   by mistake.
7. The setup steps live in two places that drift apart. The setup instructions hold the host's
   steps, and the entrypoint holds the container's. A step that the instructions name and the
   entrypoint never runs leaves every container misconfigured.
8. The checks that exist can pass a broken setup. For example, a check can test a linter by asking
   it to print its configuration. That check passes even when the styles the linter needs were never
   fetched. Linting a sample file would catch the missing styles.

## What the `skills` CLI does

This section comes from the CLI's source, at `vercel-labs/skills` commit `671e8c3`. That commit is
the `gitHead` of npm's `skills` 1.7.2, published 2026-10-09. The source was read, and nothing was
run but `npm view`. So no line here was confirmed by a run, and a person should spot-check the lines
that a decision rests on.

- **Where it writes.** A project install writes `.claude/skills/<name>/` and a `skills-lock.json`
  in the directory it runs in. By default the skill directory is a relative link into a copy under
  `.agents/skills/`. With `--copy` it copies the files instead. A global install writes under
  `CLAUDE_CONFIG_DIR`, or `~/.claude`, and keeps its own lock in `~/.agents/`.
- **What its lock is worth.** The lock records each skill's source, the ref typed and a hash. Its
  restore command, `experimental_install`, "Does not install to agent-specific directories", so it
  never fills `.claude/skills/`. Nothing compares the hash at any point.
- **Where an unpinned install comes from.** With no `#ref`, it downloads the skill from
  `skills.sh/api/download/...`, which is Vercel's server, and checks nothing against GitHub. With an
  explicit ref it clones from the repository instead. A full commit SHA pins a skill so that
  `update` leaves it where it is.
- **Whose token it uses.** On that unpinned path it sends `GH_TOKEN` or `GITHUB_TOKEN` to GitHub's
  API, or else runs `gh api`. So in a container where `gh` carries a privileged credential, the CLI
  uses that credential.
- **Telemetry.** It is on by default, and it reports the source, the skill names and the agent to
  `skills.sh`. `DISABLE_TELEMETRY` or `DO_NOT_TRACK` turns it off.
- **How it fails.** `add` exits 1 on any failed skill. `remove` exits 0 even when a removal fails.
- **What runs at install.** No skill code runs. The install only copies files.
- **What it does with audits.** `add` prints the audit results as a note and never blocks: "security
  info is advisory only". `update` runs `add -y`, so it never blocks either. With telemetry off it
  does not read them at all.

## What the skills.sh audits give

This section comes from https://www.skills.sh/audits, its API docs and one real response, all read
on 2026-10-10.

- **Who audits.** Partner scanners: "Gen Agent Trust Hub, Socket, Snyk, Runlayer, ZeroLeaks"
  (https://skills.sh/docs/api). They look for injection, exfiltration, credential exposure,
  obfuscation and the like.
- **What a script can read.** `GET https://skills.sh/api/v1/skills/audit/<owner>/<repo>/<skill>`
  answered with no auth. Each provider gives a `status` of `pass`, `warn` or `fail`, a `riskLevel`,
  a `summary` and an `auditedAt`. The docs say that endpoint needs a token, so that may change. Use
  is rate-limited per IP, and the terms encourage caching the results.
- **What a result describes.** It describes skills.sh's latest snapshot of the skill, and names no
  commit. Snapshots lag the source (https://github.com/vercel-labs/skills/issues/1273). **So no
  audit can say what the pinned commit holds.** It can only say that something about this skill
  worried a scanner.
- **When one exists.** Audits "are generated automatically after a skill is installed for the first
  time". A skill that nobody has installed with telemetry on answers 404.
- **When one changes.** A skill that passed can be flagged later. No feed of new flags exists.
- **How noisy it is.** The most-installed skill, `vercel-labs/skills/find-skills`, carries a Snyk
  `warn`, "Risk: MEDIUM · 1 issue". So a rule that holds every `warn` would hold it.

## The design

### The wanted state

- **Which plugins.** `enabledPlugins` in `.claude/settings.json` stays the one list, because Claude
  Code reads it.
- **Where each marketplace comes from.** A new key in the policy file, `claudePluginMarketplaces`,
  maps each marketplace name to its source, `owner/repo#<tag>`. Each marketplace is pinned to a tag.
  Some plugins ship from the same repository as a CLI that the toolchain pins. For each of those,
  the marketplace's tag is held to the CLI's pin. A marketplace that the entrypoint uses for a
  user-scope plugin joins the key too, so the entrypoint stops spelling its own source. Choose a
  policy file that the container image already copies in, so that the entrypoint can read it.
- **Which skills the `skills` CLI installs.** A second key in the same file, `installedSkills`, is a
  table keyed by skill name. Each row gives:
  - the source path and a full 40-character commit SHA, since without a pin the skill comes from
    Vercel's server unchecked;
  - the reason the repository wants it;
  - the assessment it passed: the commit it read, the commit of `CLAUDE.md` it judged against, and
    the issue holding the operator's choice when it found anything;
  - the audit result the operator accepted, per provider: its `status`, `riskLevel` and
    `auditedAt`.
- **Which `skills` CLI runs.** The CLI becomes a dev dependency, so a locked install gives one
  version, and the scripts run `node_modules/.bin/skills`. `npx skills` would fetch whatever version
  is latest at that moment.
- **Who merges a change.** `.claude/settings.json`, the dependency manifest and the two new keys
  are protected paths. A changed source installs another repository's code on every machine, so
  every admission and every removal waits for a person's merge. Where protection works per file and
  not per key, put the two keys in a file of their own.
- **A committed-files check** refuses these:
  - an enabled plugin whose marketplace has no source, or a source with no tag;
  - a marketplace tag that differs from the CLI pin it is held to;
  - a source that neither an enabled plugin nor the entrypoint uses;
  - an installed skill with no full commit SHA, or with no reason;
  - an installed skill whose name a tracked skill already holds, since the install would write
    over that directory;
  - an installed skill whose assessment read another commit than its pin, so a pin cannot move
    without a new assessment;
  - an installed skill whose assessment found something and names no issue.

  Because it reads only committed files, it runs in the pre-push hook and in CI.

### Admitting a skill: the two checks

A skill is admitted when it is added to `installedSkills`. It is admitted again when its pin moves.
These are the steps:

1. A session runs an `add-skill` skill with a source and a skill name, or with a new pin.
2. The skill looks first for a prior decision on that skill, in the decision record and in closed
   issues. A skill once rejected is not re-argued without new evidence.
3. It resolves the ref to a full commit SHA. It fetches the skill at that SHA into a scratch
   directory with the locked CLI, `--copy`, telemetry off and no token. Nothing lands in
   `.claude/skills/` yet.
4. It runs three checks on the fetched files:
   - **A deterministic pass.** Each shell command in the skill's code blocks goes through the
     decision logic of the repository's command-guard hooks, if it has any. Each command also goes
     through a list of commands the repository forbids. A model cannot talk this pass out of a
     finding. The guards may first need to export their logic as a function.
   - **The agentic assessment.** A new read-only agent, `skill-assessor`, reads the skill as data.
     Its only tools are Read, Grep and Glob. Its rubric is in the next section.
   - **The audit.** The skill reads the skills.sh audit for the skill. Every provider result other
     than `pass` is a finding. A 404 is also a finding, because it means no audit exists. The fetch
     in step 3 runs with telemetry off, so it never causes an audit. A skill few people install can
     therefore stay at 404, and the operator then accepts it unaudited or waits.
5. If no check finds anything, the session adds the row and opens a pull request. The pull
   request's description carries all three results. A person merges it, because the table is a
   protected path, and that merge is the acceptance.
6. If any check finds something, the session files an issue with the findings and the three
   options, and stops. The operator reads the findings and chooses:
   - **accept:** a session adds the row, naming the issue and the audit result accepted, and opens
     the pull request;
   - **reject:** the issue closes with its reason, so the next proposal finds why;
   - **reconcile:** a fuller adoption review runs on the skill, and its result becomes a note on the
     issue. Its options include vendoring an adapted copy as a tracked skill, and changing a rule
     of the repository.
7. For a pin move, the assessor also reads the diff from the old commit to the new one.

The assessment runs at admission and at each pin move, and not at each machine's sync. The pin fixes
the skill's text, so one assessment covers every machine. A model judges the same text differently
from run to run, so a sync that ran one would let machines disagree about the same commit. A sync
that ran one would also need a model key and spend money at every container start. The audit is
different: it can change while the pin stands still, so it runs at sync too.

### The assessor's rubric

The rubric says what a conflict with the repository looks like:

- **It contradicts a rule.** It contradicts `CLAUDE.md`, a tracked skill or agent, or a recorded
  decision. For example, a plugin's priming text can tell a session to write memories, commit or
  push where `CLAUDE.md` says otherwise.
- **It runs what is refused here.** It tells a session to run a command that a guard refuses or the
  repository forbids.
- **It writes where it steers later runs.** It writes into a memory store, into `CLAUDE.md` or into
  user-level files.
- **It competes with a skill already here.** Its description claims the same trigger as a tracked
  skill. Then nobody can predict which one a session picks.
- **It reaches outside.** It reaches the network or secrets, or runs scripts it bundles. The audit
  covers part of this ground from the other side.
- **It costs context.** Every session loads its description, so the assessor reports its size and
  the operator weighs it.

The assessor reports at most a fixed number of findings, which the policy file sets. Each finding
gives the skill's line and the home of the rule it meets. The assessor can run no command, because
the text it reads is untrusted and may try to instruct it. Weakening the assessor would let a risky
skill through, so `.claude/agents/skill-assessor.md` is a protected path. The assessor calls a model,
so it runs in neither the pre-push hook nor CI. Its selftest runs over fixtures with a stubbed
agent, and runs in both.

### The checks stop judging an installed skill as the repository's own

An installed skill is upstream's text, like a plugin's skill, so the repository's prompt rules cannot
hold it. The admission checks above stand in for those rules. Each reader below needs one narrow
exception. Each exception applies only to a `.claude/skills/<name>/` that git does not track and
`installedSkills` names:

- A check that reads skills from disk skips it. That check still refuses a tracked skill of the same
  name, and an untracked one the table does not name.
- A session hook that lints untracked files skips it. If that hook lists untracked files through
  git's standard excludes, the exclude lines below may be enough on their own (not checked).
- A tool that lists the prompts a session loaded leaves it out, as it leaves out a plugin's skill.

Each of those readers' own selftest gets a case for each side of its exception.

### One script makes a machine match the lists

The sync script is a Node script, so it runs on macOS, Linux, Windows and in the container. On each
run it does these steps:

1. It reads the wanted state from the files above.
2. It reads the machine's state. For plugins it uses `claude plugin marketplace list --json` and
   `claude plugin list --json`. For installed skills it reads the `skills-lock.json` the CLI wrote,
   and the directories under `.claude/skills/` that git does not track.
3. For each installed skill, it reads the skills.sh audit, as § The audit at each sync says.
4. It acts on each difference, as the table below says.
5. It prints one line per action. With `--dry-run` it prints the actions and changes nothing. The
   doctor uses that mode to ask it for drift.

| What it finds | On the host | In the container |
|---|---|---|
| An enabled plugin whose marketplace is not registered | adds the marketplace | same |
| An enabled plugin with no project record for this clone | `claude plugin install --scope project` | same |
| A project record for this clone whose plugin is no longer enabled | `claude plugin uninstall --scope project` | same |
| A registered marketplace that nothing wanted uses | prints it, leaves it | removes it |
| A wanted skill missing from `.claude/skills/`, its audit no worse than accepted | `skills add <source>#<sha> -a claude-code -s <name> --copy -y` | same |
| A wanted skill whose audit is now worse than accepted | holds it | same |
| An installed skill whose pin moved in the table | removes it, then adds it at the new pin | same |
| A skill the CLI's lock records that the table no longer names | `skills remove -a claude-code -s <name> -y` | same |
| A tracked skill, a user-scope or local record, or a record for another path | leaves it | leaves it |

Rules it keeps:

- **It runs from the primary checkout**, which `git rev-parse --git-common-dir` finds. The plugin's
  project record names the primary clone, and that one record serves the clone's worktrees. With
  Claude Code 2.1.296, `claude plugin list --json` run from a worktree gave the primary clone as
  `projectPath`, with `projectEnabled` true. The plugin's skills loaded in that worktree.
- **It removes only what it owns.** It removes a skill directory only when git does not track it
  and the CLI's lock records it. It never touches a tracked skill. On the host it never touches the
  personal skills directory under the Claude Code config directory.
- **It checks what the CLI does not.** After `skills add` it checks that `SKILL.md` exists. After
  `skills remove` it checks that the directory is gone, since `remove` exits 0 on a failure. Either
  miss is a failure.
- **It hides what it installs from git.** It writes one line per installed skill into the clone's
  `info/exclude`. It also writes one line for `skills-lock.json` and one for `.agents/`. No tracked
  file holds a second copy of the names. Whether linked worktrees share that file was not checked.
- **It gives the `skills` CLI nothing to leak.** It runs the CLI with `DISABLE_TELEMETRY=1`, with
  `GH_TOKEN` and `GITHUB_TOKEN` unset, and with a `PATH` that leaves out any `gh` that carries a
  credential. It reads the audits itself, with no token either.
- **It passes no `-y` to `claude plugin install`.** An install that would run a command is left to a
  person. `skills add` gets `-y`, since it runs no code and only copies files.
- **It refuses to leave a tracked file changed.** After a plugin uninstall it checks that
  `.claude/settings.json` has no diff. When it finds one, it fails with that reason. The docs say
  that the `/plugin` panel's "Uninstall for everyone" edits that file. The docs do not state what
  the CLI's uninstall edits (not verified).
- **It skips clean when `claude` or the `skills` CLI is absent**, and prints why. A tool that is
  found and then fails is a failure. With `--warn-only` it prints the failure and exits 0. The
  entrypoint and the git hook pass that flag, because nothing in the entrypoint should fail the
  container's start.
- **It owns marketplaces only where it owns the Claude Code config directory.** That directory is
  `CLAUDE_CONFIG_DIR`, or `~/.claude` when the variable is unset. The entrypoint passes
  `--owns-user-config`, because the container's config directory belongs to the container. On the
  host, the config directory is the person's, and another project of theirs may install from the
  same marketplace. So the host prints an unused marketplace and leaves it.
- **It warns when the rules moved after an assessment.** Sometimes `CLAUDE.md` has changed since the
  commit that a row's assessment judged against. The script then says so and names the skill. It
  still installs the skill.

The script gets two tasks in the task runner:

- **An install task** runs it. The script reads the Claude Code config directory and skills.sh,
  which are outside the repository. So the install task runs in neither the pre-push hook nor CI.
- **A selftest task** runs it against a stub `claude`, a stub `skills` and a stub audit server on
  loopback. It has one case per row of the table, one for each rule, and one control case that
  changes nothing and must pass. Each other case breaks one thing and asserts that the run fails for
  that reason. The selftest runs in the pre-push hook and in CI.

### The audit at each sync

An audit can worsen while the pin stands still, so every sync reads it again. These are the steps:

1. The script reads each installed skill's audit once per run, with a short timeout.
2. It compares each provider's result with the one the row accepted. A result is worse when its
   `status` moved from `pass` towards `fail`, or its `riskLevel` rose. A provider the row never
   saw counts as new, and any result from it other than `pass` counts as worse.
3. A result no worse than accepted lets the install go on. That is how a skill like `find-skills`
   stays installed, once the operator has accepted its `warn`.
4. Some worse results remove the skill from the machine: a `status` of `fail`, or a `riskLevel` of
   HIGH or CRITICAL. A lesser worsening only warns, and the skill stays.
5. Either way the script prints the skill, the provider and both results. It also prints the step
   that reopens the skill, which is the `add-skill` skill on that name. It files no issue itself,
   because a sync runs in the entrypoint, where tracker writes do not belong.
6. An audit that cannot be read leaves the accepted result standing. That covers a timeout, a 401,
   a 404 or skills.sh being down. The script says so, so an outage of skills.sh stops no machine.

A person still has to compare a flag with the pinned commit, because the audit describes skills.sh's
snapshot, which names no commit.

### One command sets a machine up: bootstrap

The bootstrap script runs every setup step that a program can run, in order, on every route. It is
the one home of those steps. The setup instructions keep only the steps a person must take. They say
that the bootstrap script wins for the steps it runs. The entrypoint calls the bootstrap script, so
the host and the container stop drifting apart.

The bootstrap script imports nothing from `node_modules`, because it runs before the package
install. A person runs it through the task runner. Some task runners install the pinned tools
before any task runs. With one of those, Node is there when the script starts.

Its steps follow, in order. Each step checks first and does nothing when nothing is needed, so a
second run is cheap:

1. **It checks what only a person can fix.** It checks the minimum versions of the tools a person
   installs, such as git and the task runner. It checks that the task runner's shims come first on
   the `PATH`. A miss stops the run, naming the setup step that fixes it.
2. **It installs the toolchain**, on the host. In the container the image holds the toolchain, so
   the doctor warns of a lag instead.
3. **It installs packages** with `npm ci`, when the lockfile's hash differs from the one the last
   install recorded.
4. **It installs the git hooks.**
5. **It fetches the data that linters need**, such as a prose linter's styles, when a lint of a
   sample file fails. This step needs the network.
6. **It sets up the local config that the repository's tools need**, such as the tracker's database,
   its settings and its directory permissions.
7. **It matches both lists** with the sync script. This step comes after the tools that a plugin's
   hooks call are in place.
8. **It runs the doctor** and prints its summary.

What it never does: edit a shell profile, trust the task runner's config, log in to Claude Code, or
place a secret. Each of those is a person's step. The doctor reports each one that is missing.

Its flags:

- `--container`, which the entrypoint passes, skips step 2 and the `PATH` check of step 1.
- `--warn-only`, which the entrypoint also passes, prints a failure and goes on, and exits 0.
- `--dry-run` prints each step it would take.

The bootstrap script changes the machine and reads the network, so it runs in neither the pre-push
hook nor CI. Its selftest runs it over fixtures with stubbed tools, in both.

### One command says what is wrong: doctor

The doctor script probes the machine and changes nothing. It prints one line per probe, as ok, warn
or fail. Each line names the command that fixes it, which is often the bootstrap task. It exits 1 on
any fail. It also imports nothing from `node_modules`, so it runs when the package install has
failed.

Its probes:

| Area | Probe | Why |
|---|---|---|
| Toolchain | the tools a person installs meet their minimum versions, and the task runner reports no missing pin | a missing tool fails a later step with an error that does not name it |
| Toolchain | the task runner's shims come first on the `PATH` a new shell gets | a hook that cannot find its tool can stop working without saying so |
| Toolchain | each pinned runtime and CLI answers with its pinned version | a stale version passes some checks and fails others |
| Checkout | `node_modules` matches the lockfile's hash | an old install runs old code |
| Checkout | the git hooks are installed | the pre-push checks run only through them |
| Checkout | a sample file lints with every style the linter's config names | asking the linter for its config passes when styles are missing |
| Tracker | the tracker's local setup is in place | the tracker's errors arrive later, in the middle of work |
| Claude Code | the sync script's dry run finds nothing to do, and no installed skill is held | this plan |
| Container | each thing the entrypoint sets up works, such as credentials, the commit identity and optional plugins | the entrypoint runs with no one watching, so its warnings go unread |

Every probe that the entrypoint runs today as a warning moves into the doctor, so each probe has one
home. The entrypoint keeps only the steps that it alone can take, such as the clone, credentials and
the commit identity.

The doctor reads the machine, so it runs in neither the pre-push hook nor CI. It costs seconds, so
it is no session hook either. One `claude plugin list --json` call took 0.65 s when it was measured.
The doctor runs at the end of bootstrap, at the end of the entrypoint, and by hand. Its selftest
gives each probe one case that breaks it in a fixture and asserts its reason. The selftest adds one
control case, and runs in both the pre-push hook and CI. A hook can see a different `PATH` from the
one the task runner hands the doctor. How the doctor reads the hook's `PATH` is a point to probe
first.

Its first acceptance test: on a machine with known setup drift, it reports each drifted step.

### Worktrees

An installed skill is an untracked directory in the primary checkout, so a new worktree does not get
it from git. Suppose the repository has a script that cuts worktrees. That script copies each skill
that `installedSkills` names from the primary checkout into the new worktree, which needs no
network. A worktree cut before a change keeps what it had. Short-lived worktrees keep that cheap,
because the next one cut gets the current set. A held skill is not copied.

### Where it runs

| Trigger | Host | Container |
|---|---|---|
| Setup | the setup instructions, for each platform: the person's steps, then the bootstrap task | the entrypoint makes the clone, then runs `bootstrap --container --warn-only`. The Dockerfile's build-time marketplace registration goes, since the entrypoint registers anyway |
| The checkout moves | a non-gating git-hook job runs the install task when `.claude/settings.json` or the policy file changed between the old head and the new | the same job, since the container's clone installs the same hooks |
| A worktree is cut | the worktree script copies the installed skills | same |
| A skill is added, or its pin moves | the `add-skill` skill, in a session | same |
| Anything seems wrong | the doctor task | same, and at the end of every start |

Find out which git hooks the repository's pull fires before choosing `post-checkout`, `post-merge`
or `post-rewrite` for the job. A pull with `--rebase` may fire different hooks from a merge pull.

### Removing a skill, end to end

1. A pull request removes the skill from its list. For a plugin, that is its `enabledPlugins` entry
   and, when nothing else uses it, its marketplace. For an installed skill, that is its row in
   `installedSkills`. A person merges the pull request, because both lists are protected paths.
2. A machine pulls. The git-hook job sees that a list changed, and it runs the install task.
3. The script finds what is no longer wanted and removes it. For a plugin, it uninstalls this
   clone's project record. For an installed skill, it runs `skills remove` and checks that the
   directory is gone. The skill stops loading at the next session at the latest (not verified).
4. In the container, the script also removes an unused marketplace. On the host, it prints that the
   marketplace is unused and leaves it.
5. Some machines' hooks did not run. Each of those catches up at its next bootstrap, and the doctor
   reports the drift until then. A container catches up at its next start.

### Tracked skills

Tracked skills need no machine step. What they lack is one list of the files a person edits by hand
when a skill comes or goes. The list depends on the repository, and can include these:

- the skill's row in any per-prompt budget or policy file;
- its entry in any list of prompts that a review tool skips;
- its row in the README's list of skills;
- test cases whose subject is the skill;
- every file that cites it by name.

The `add-skill` skill holds that list too, beside the admission steps above. Whatever skill or
checklist retires a file gains the same list for removal. Some tracked skills are hand copies of an
outside skill. Each of those should record its source and version, or move to `installedSkills`
through the admission steps.

### What this plan leaves alone

- A person's user-scope plugins, and their personal skills, on the host.
- Global installs by the `skills` CLI. On the host they would land in every project of the person's.
  The docs also say a personal skill wins over a project skill of the same name. So a global install
  could shadow a tracked skill (skills docs; not verified).
- The assessment of a plugin's skills. A plugin's text can conflict with the repository's rules as
  an installed skill's text can. So that assessment is worth separate work once the assessor exists.
  skills.sh audits no plugin.
- Packaging the repository's own skills as a plugin.
- Managed settings. A `/etc/claude-code/managed-settings.json` in the image could force-enable
  plugins (managed-settings docs; not verified). That file would be a second home for the plugin
  list. Also, nobody in the container could turn a plugin off, and the host has no such file.
- Turning off one skill of a plugin. The docs say `skillOverrides` does not reach plugin skills.
  They do not say whether a `Skill(...)` deny rule does.
- Running the full check suite inside bootstrap. The suite takes far longer than every other step,
  so it stays the person's last setup step.

## Decisions, and what each gives up

Each choice below names what it gives up, so that its decision record can say so.

- **Installed skills are admitted**, under two conditions. An agentic assessment catches conflicts
  with the repository's rules. The skills.sh audits flag security issues at add, update and sync. A
  finding from either check waits for the operator to accept, reject or reconcile it. Record this
  choice as a decision. A repository may hold that every rule an agent follows lives in a tracked
  file. Admitting outside skills departs from that rule, so the record says why. The choice gives
  up this: an installed skill loads word for word, so a conflict the assessment misses reaches every
  session, and nobody in the repository can edit the text.
- **The assessment runs at admission and at each pin move.** It gives up this: suppose a rule is
  added to `CLAUDE.md` later, and an admitted skill breaks it. That skill only draws a warning at
  each sync until someone re-runs the assessment.
- **A worse audit at sync removes the skill at `fail`, HIGH or CRITICAL, and only warns below.** It
  gives up this: a scanner's false positive removes a good skill from every machine until the
  operator accepts the result.
- **The marketplace sources live in the policy file**, with bootstrap and doctor added so that a
  person who skips the manual steps is caught. It gives up what `extraKnownMarketplaces` in
  `.claude/settings.json` might have given. A person who clones and starts `claude` without running
  bootstrap still has no plugin. The doctor says so, but only once someone runs it.
- **The host leaves an unused marketplace registered, and prints it.** It gives up this: a dropped
  marketplace stays in the person's config directory, and `claude plugin marketplace update` keeps
  fetching it.
- **A pull re-runs the install task through a git-hook job.** It gives up this: a skill a person
  merged minutes earlier can install in the middle of an agent's run.
- **Each marketplace is pinned to a tag**, and a marketplace that shares a repository with a pinned
  CLI has its tag held to that pin. It gives up this: an upstream fix reaches no machine until
  someone moves the pin by hand.

## Work items

Each item is one issue, and all are children of one epic. The last column names the items that must
land first.

| # | Item | Lands in | After |
|---|---|---|---|
| 1 | The decision record for admission, with its two conditions and what it gives up | the decision record | none |
| 2 | An adoption review of the `skills` CLI as a dev dependency, with its trials run in a sandbox | the issue's notes | 1 |
| 3 | Probes, with a throwaway `CLAUDE_CONFIG_DIR`: what `claude plugin uninstall --scope project` edits; what `projectPath` an install from a worktree writes; which hooks the repository's pull fires; whether `claude plugin install` refuses a command-source plugin without `-y` and without a terminal; whether `skills add --copy` writes `.agents/`; whether worktrees share `info/exclude`; whether the command guards export their decision logic; how a script reads the `PATH` a hook sees; how each pinned CLI's repository names its tags | the issue's notes | none |
| 4 | The two keys, the committed-files check, and their protection | the policy file, `package.json`, the protected-path config | 1, 2, 3 |
| 5 | The `skill-assessor` agent, its rubric, its selftest with a stubbed agent, and its protection | `.claude/agents/`, the protected-path config | 1 |
| 6 | The audit reader, shared by admission and sync, with its loopback stub | the scripts directory | 4 |
| 7 | The `add-skill` skill: the admission steps, the issue on a finding, the three choices and the tracked-skill list; and the same list in whatever retires a file | `.claude/skills/` | 5, 6 |
| 8 | The narrow exceptions in the check that reads skills from disk, the hook that lints untracked files and the tool that lists loaded prompts, each with its selftest cases | those checks and hooks | 1, 4 |
| 9 | The sync script, its install task and its selftest | the scripts directory, the task runner's config, the git hooks, CI | 4, 6 |
| 10 | The doctor script, its task and its selftest. Its first acceptance test is reporting a machine's known drift | the scripts directory, the task runner's config, the git hooks, CI | 3, 9 |
| 11 | The bootstrap script, its task and its selftest, and the setup instructions rewritten around it for every platform | the scripts directory, the task runner's config, the git hooks, CI, the README | 9, 10 |
| 12 | The entrypoint runs bootstrap and doctor, and keeps only the steps it alone can take. Its user-scope plugin reads its source from the policy file. The Dockerfile drops its build-time marketplace registration. Each change gets a selftest case | `.devcontainer/` | 11 |
| 13 | The git-hook job re-runs the install task after the checkout moves, with a case in the hook runner's selftest | the git hooks | 3, 9 |
| 14 | The worktree script copies the installed skills into a new worktree | the worktree script | 9 |
| 15 | Each hand-copied outside skill records its source and version, or moves to `installedSkills` through admission | `.claude/skills/` | 7 |

Item 12 also fixes setup drift for every container, because bootstrap runs the steps the entrypoint
skipped. An item that changes a protected path waits for a person's merge.

## Where the Template stands

Wired on 2026-10-12. The Template's `.claude/settings.json` is rendered, so `enabledPlugins` comes
from `policy/skill-sources.json` `claudeEnabledPlugins`, beside the other two lists. All three
start empty; a Target project adds rows through the `add-skill` skill.

| # | State in the Template |
|---|---|
| 1 | `docs/adr/0002-admit-installed-skills.md` in this repository; a Target's first admission also records its own, as the `add-skill` skill says |
| 2 | Adopted: `skills` 1.7.2, exact, in `package.json`, after the trials below. It brings two dependencies (`tar`, `yaml`), no install script, an MIT licence and 600 kB unpacked, and needs Node 22.20.0 or later |
| 3 | Probed on 2026-10-12; the results are below, and in the headers of `scripts/skill-sources.mjs` and `scripts/doctor.mjs` |
| 4 | `policy/skill-sources.json` and `mise run skills:check`. Not done: the protection. The Template has no protected-path config, and Deploy sets no branch protection or ruleset to give one force |
| 5 | `.harness/agents/skill-assessor.md`; `skills:check` refuses it with any tool but Read, Grep and Glob. No stubbed-agent selftest: no code reads the assessor's report, so a stub would test nothing. Codex renders it with no tool limit |
| 6 | `readAudit` in `scripts/skill-sources.mjs`, over a stub on loopback in its selftest |
| 7 | `.harness/skills/add-skill/SKILL.md`, with the deterministic pass as `skill-sources.mjs scan`, which runs each guard as a process, so no guard exports its logic |
| 8 | Nothing to except: the renderer judges only files it owns, and no check reads untracked skills |
| 9 | `scripts/skill-sources.mjs sync`, `mise run skills:install`, `skills:selftest` in pre-push and CI |
| 10 | `scripts/doctor.mjs`, `mise run doctor`, `doctor:selftest` in pre-push and CI; no linter probe, since the Template has no linter |
| 11 | `scripts/bootstrap.mjs`, `mise run bootstrap`, `bootstrap:selftest` in pre-push and CI; the Template has no host setup README to rewrite |
| 12 | The entrypoint runs bootstrap, which ends with the doctor; its plugin functions and the token and toolchain warnings are gone |
| 13 | post-checkout and post-merge jobs run the sync with `--since`. A rebase pull fires post-checkout as it checks out the upstream, so it syncs too, before the local commits are replayed |
| 14 | `scripts/new-worktree.sh` runs `skill-sources.mjs copy` |
| 15 | Done: `root-cause`, the one hand copy, records obra/superpowers' `systematic-debugging` at 8ca22db |

The Template test's Bootstrap step checks the doctor's summary, the host route's second run, and a
branch's new `installedSkills` row reaching the clone through the post-checkout hook.

### What the probes found

They ran on 2026-10-12, with Claude Code 2.1.296, `skills` 1.7.2, Git 2.54.0 and mise 2026.10.6,
against a throwaway `CLAUDE_CONFIG_DIR`, a local marketplace and scratch repositories.

- **`claude plugin install --scope project`** records the checkout it ran in as `projectPath`. From
  a linked worktree, that is the worktree. It needs no terminal and no `-y` for a plugin with no
  command. It rewrites `.claude/settings.json` with `enabledPlugins` as the last key. The renderer
  wrote that key first, so every machine's first sync would have edited a rendered, tracked file.
  The renderer now writes it last, and sync fails on such an edit after an install, as it did after
  an uninstall.
- **`claude plugin uninstall --scope project`** deletes the plugin's entry from
  `.claude/settings.json`. It leaves a file with no entry for the plugin unchanged, and that is the
  file the renderer writes once the plugin leaves the list. It leaves the plugin's cache.
- **`skills add <source>#<sha> -a claude-code -s <name> --copy -y`** writes only
  `.claude/skills/<name>/` and `skills-lock.json`, and no `.agents/`, so sync no longer excludes
  `.agents/`. The lock's `ref` is the full SHA. **`skills remove -a claude-code -s <name> -y`**
  deletes the directory and the lock entry, and exits 0 when it finds nothing.
- **Pulls.** A merge pull fires post-merge. A rebase pull fires post-checkout, then post-rewrite.
- **`info/exclude`** is shared. A linked worktree's `git rev-parse --git-path info/exclude` gives the
  primary's.
- **A hook's PATH** is its caller's, with git's exec-path in front. `mise run` puts each pin's
  install directory in front of the doctor's PATH, so its node probe always passed under `mise run
  doctor`. The probe now asks a new login shell, started with a bare environment as a new terminal
  would start one.
- **Tags.** `cli/cli` and `gastownhall/beads` tag their releases `v<version>`, which `skills:check`
  matches to the mise pin.
