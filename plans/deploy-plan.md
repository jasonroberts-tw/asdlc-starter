# Deploy implementation

**Written:** 2026-10-12
**Status:** Implemented and verified on 2026-10-12 through the Template test and Deploy selftest.

The acceptance criteria live in [template-test-plan.md](template-test-plan.md) under
"What the Template test requires of Deploy"; that contract wins if this document disagrees.

`node scripts/deploy.mjs --values values.json [--integrations claude,codex] <target-dir>`
deploys from this checkout's tracked Template paths and their current working-tree bytes. It needs
Node, git, and the Template's pinned bd, with no npm installation. Claude is the default integration.

Deploy validates the target, values, tracked source files, and integration selection before writing.
The target must be the root of an empty, non-bare git repository: no commits, no existing files
apart from `.git`, and an origin. An occupied origin is refused rather than replaced.

The Tracker probe found that bd 1.3.0 adds `.beads/README.md` and `.beads/metadata.json`, strips the
configuration's final newline, and commits automatically. Deploy restores the substituted Template
bytes after init, stages the complete result, and amends that newly created local root commit.
It sets committed executable modes explicitly, including rendered assets, so `core.filemode=false`
cannot change the source index's contract.
It never amends a pre-existing commit. It pushes `main`, then publishes the Tracker with
`bd dolt push`: the local git remote transport needs a branch before accepting Dolt data.
Success requires both pushes and a clean working tree.

Validation refusals leave the target untouched. A failure after copying can leave files, the local
root commit, or published Tracker data for diagnosis. Deploy reports the failed operation and does
not delete local work or attempt to roll back a remote. Use a fresh empty repository for another run.

`node --test scripts/deploy.selftest.mjs` exercises successful deployment, every specified refusal,
integration selection, exact source bytes/modes, and safe handling of existing destinations.
