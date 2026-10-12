**These scripts deploy the tracked Template and test Deploy's public CLI contract.**

The acceptance criteria in [the Template test plan](../plans/template-test-plan.md) win if these
instructions disagree; [the Deploy plan](../plans/deploy-plan.md) explains implementation choices.

| File | Role |
|---|---|
| `README.md` | Commands and requirements for these scripts |
| `deploy.mjs` | Substitutes values, renders selected integrations, creates and publishes the Tracker and initial commit |
| `deploy.selftest.mjs` | Exercises successful deployments, tracked bytes/modes, selected integrations, and refusals in scratch repositories |

Run Deploy from this checkout with Node, git, the Template's pinned bd, and a configured git identity:

```sh
node scripts/deploy.mjs --values values.json [--integrations claude,codex] ../target
```

Use an empty git repository with an empty `origin`. Start the values file from
[`tests/template/fixtures/values.json`](../tests/template/fixtures/values.json) and replace its dummy
project and App identity with the project's values. `trackerRemote` defaults to origin's URL.
Values are nonempty strings or safe integers; quotes, backslashes, line breaks and unresolved
placeholders are refused because substitution must preserve the surrounding Template formats.

Only tracked Template paths are copied, using their current working-tree bytes and index modes.
Stage new Template files before deploying. Deploy preserves existing work by refusing occupied
targets and origins. Validation failures leave the target untouched; failures after writing can
leave files or a published commit for inspection. Use a new empty target for another attempt.

Run the selftest with the pinned toolchain:

```sh
cd template
mise exec -- node --test ../scripts/deploy.selftest.mjs
```

The tests create local disposable Git and embedded Tracker repositories. They need no npm
installation, GitHub access or model credential.
