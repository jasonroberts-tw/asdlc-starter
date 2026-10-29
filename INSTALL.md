# Deploying the Template

**Agent: follow this page to walk a person through Deploying the Template into a new Target
project.** Run each command yourself and ask the person only what you cannot look up. Ask one
question at a time and suggest a default for each. Stop and report on any failed check. Never delete
or overwrite a repository, App or directory unless the person explicitly tells you to.

Run every command from this checkout's root. Commands are POSIX `sh`. Set the shell variables below
as you learn each value.

## 1. Check the tools

```sh
gh auth status          # logged in to github.com
gh auth setup-git       # lets git and the Tracker push to an HTTPS origin with gh's login
git config user.name && git config user.email
node --version
mise --version && mise trust template
```

Deploy commits as the git identity above, so ask the person to set one if it is missing. If `gh` or
`mise` is missing, have the person install it and then run this step again.

## 2. Choose the Target project

Ask for these values:

- **`TARGET`**: an absolute path for the new local project. It must not exist yet, or it must be an
  empty directory.
- **`OWNER`**: the GitHub account or organization that will own the repository. Default:
  `gh api user --jq .login`.
- **`REPO`**: the repository name. Default: the last segment of `TARGET`.
- **`INTEGRATIONS`**: a comma-separated list of `claude`, `codex`, `copilot` and `opencode`, such
  as `claude,copilot`. Default: `claude`.

```sh
test ! -e "$TARGET" || test -z "$(ls -A "$TARGET")"   # refuse an existing, non-empty directory
```

## 3. Get or create the repository

```sh
gh repo view "$OWNER/$REPO" --json visibility,isEmpty,url
```

- **It exists:** it must be `PUBLIC` with `isEmpty: true`. Deploy refuses any origin that already
  has a commit. The dev container clones the repository without a token, so the repository must be
  public. If either condition fails, ask the person for another name. Do not empty or change an
  existing repository.
- **It does not exist:** create it with no README, licence or `.gitignore`:

  ```sh
  gh repo create "$OWNER/$REPO" --public
  ```

Then make the Target an empty repository whose origin is this repository:

```sh
mkdir -p "$TARGET" && git -C "$TARGET" init
git -C "$TARGET" remote add origin "https://github.com/$OWNER/$REPO.git"
```

## 4. Get or create the GitHub App, or go without one

The dev container's agents act as a GitHub App. The App is optional, because changes can also be
made on the host, where git and `gh` use the person's own account. Without an App, the dev
container can clone and work locally, but it cannot push or call GitHub. Ask whether the person
wants an App for this project. If they do not, skip to step 6 and leave the four App values out.

Ask whether the person already has an App for this project. If they do, set `APP_SLUG` to the name
shown in its URL (`github.com/apps/<slug>`) and `APP_ID` to the **App ID** under **About** on its
settings page. Skip to **Installation** if it is already installed on this repository only.

**Create** (`gh` cannot create an App, so the person does this in the browser). Send them to
`https://github.com/settings/apps/new`, or to
`https://github.com/organizations/$OWNER/settings/apps/new` when `OWNER` is an organization. Ask
them to:

1. Give the App a name and use `https://github.com/$OWNER/$REPO` as the homepage URL.
2. Clear **Webhook → Active**.
3. Under **Repository permissions**, set **Contents** and **Pull requests** to Read and write.
   Set **Checks**, **Commit statuses** and **Actions** to Read-only. Leave **Workflows** unset.
4. Choose **Only on this account**, then create the App.
5. Tell you the slug from the App's URL and the **App ID** under **About** on its settings page.
   `gh api /apps/<slug>` returns 404 for an App that is private to its account, so ask for the ID.

**Installation:** on the App's page, choose **Install App**, pick `OWNER`, and choose **Only select
repositories → `REPO`**. A token minted from the App's key can reach every repository the
installation covers, so keep this installation limited to the one repository.

**Private key:** on the App's settings page, choose **Generate a private key**. Move the downloaded
`.pem` into the key directory the dev container mounts. That directory must hold exactly one key:

```sh
KEY_DIR="$HOME/.github-app/$OWNER/$REPO"
mkdir -p "$KEY_DIR" && chmod 700 "$KEY_DIR"
mv "<downloaded .pem>" "$KEY_DIR/" && chmod 600 "$KEY_DIR"/*.pem
test "$(ls "$KEY_DIR"/*.pem | wc -l)" -eq 1 && KEY="$(ls "$KEY_DIR"/*.pem)"
```

## 5. Look up the App's identity

```sh
BOT_LOGIN="${APP_SLUG}[bot]"   # braces stop zsh reading [bot] as an array subscript
BOT_USER_ID="$(gh api "/users/$APP_SLUG%5Bbot%5D" --jq .id)"
```

To get the installation id, sign a JSON Web Token with the App's key and ask GitHub which
installation covers the repository. This works for personal and organization owners alike. It also
proves that `APP_ID` and the key belong together:

```sh
INSTALLATION_ID="$(node -e '
const { createSign } = require("node:crypto"), { readFileSync } = require("node:fs")
const [id, pem, repo] = process.argv.slice(1)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
const now = Math.floor(Date.now() / 1000)
const body = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({ iat: now - 60, exp: now + 540, iss: id })
const jwt = body + "." + createSign("RSA-SHA256").update(body).sign(readFileSync(pem), "base64url")
fetch("https://api.github.com/repos/" + repo + "/installation", {
  headers: { authorization: "Bearer " + jwt, accept: "application/vnd.github+json" },
}).then(async (r) => {
  const j = await r.json()
  if (!r.ok) throw new Error(r.status + " " + j.message)
  console.log(j.id)
}).catch((e) => { console.error(e.message); process.exit(1) })
' "$APP_ID" "$KEY" "$OWNER/$REPO")"
```

A `404` here means the App is not installed on this repository. A `401` means the key does not
belong to `APP_ID`. As a fallback, the id is the number at the end of the installation's settings
URL (`.../settings/installations/<id>`).

## 6. Write `values.json`

Ask for **`PROJECT_NAME`**. Default: `REPO`, lowercased. It becomes the npm package name and the
Tracker's issue prefix, so use lowercase letters, digits and hyphens only. Then write `values.json`
in the shape of [values-template.json](values-template.json). Git ignores `values.json`.

```sh
cat > values.json <<EOF
{
  "projectName": "$PROJECT_NAME",
  "githubRepositoryOwner": "$OWNER",
  "githubRepository": "$REPO",
  "githubAppId": "$APP_ID",
  "githubAppInstallationId": "$INSTALLATION_ID",
  "githubAppBotLogin": "$BOT_LOGIN",
  "githubAppBotUserId": "$BOT_USER_ID"
}
EOF
```

Without an App, leave out `githubAppId`, `githubAppInstallationId`, `githubAppBotLogin` and
`githubAppBotUserId`. Deploy refuses a file that gives some of the four but not all of them.

Show the file to the person and confirm it before you deploy. Every value must be nonempty and
contain no quotes, backslashes or line breaks. `trackerRemote` defaults to origin's URL, so leave it
out.

## 7. Deploy

Deploy runs under the Template's mise toolchain, which provides its pinned bd:

```sh
(cd template && mise exec -- node ../scripts/deploy.mjs --values ../values.json --integrations "$INTEGRATIONS" "$TARGET")
```

Deploy ends with `Deployed <integrations> into <target>`. Afterwards, `main` on origin holds one
commit, and origin also holds the Tracker at `refs/dolt/data`:

```sh
git ls-remote "https://github.com/$OWNER/$REPO.git"
```

When Deploy refuses during preflight, it has changed nothing. Fix the reason it names and run it
again. A failure after Deploy has written files can leave files in `TARGET` or a commit on origin,
which Deploy keeps for inspection. Report what happened and ask the person before you clean up,
because a retry needs a new empty directory and an empty origin. [scripts/README.md](scripts/README.md)
has the rest of Deploy's contract.

## 8. Protect `main`

The Target's guards and its `open-pr` skill assume that GitHub merges a pull request into `main`
only after verify's check passes and one approving review stands. Deploy does not set this up,
because creating a ruleset needs a token with administration rights. The person sets it up in the
browser after Deploy, because Deploy pushes its commit straight to `main`.

Ask the person to open the repository's **Settings**, choose **Rulesets** under "Code, planning,
and automation", and choose **New ruleset**, then **New branch ruleset**. Ask them to:

1. Set the enforcement status to **Active**. A new ruleset starts as **Disabled**, and GitHub
   does not enforce a disabled ruleset.
2. Under **Target branches**, choose **Add a target** and include the pattern `main`.
3. Select **Require a pull request before merging**, and require 1 approval.
4. Select the rule that requires status checks to pass, and add the check `gates`. GitHub names a
   workflow's check after its job, and `gates` is the one job in the Target's
   `.github/workflows/verify.yml`.
5. Create the ruleset.

Then check that GitHub returns a `pull_request` rule and a `required_status_checks` rule for `main`:

```sh
gh api "repos/$OWNER/$REPO/rules/branches/main" --jq '.[].type'
```

The Target's doctor asks GitHub the same question at the end of every Bootstrap. It prints
`[doctor] ok   github:` when both rules hold, either from a ruleset or from classic branch
protection. It prints `[doctor] warn github:` when a rule is missing, and the warning names the
missing rule. It prints `[doctor] skip github:` with the reason when it cannot ask GitHub: the
origin is not on GitHub, `gh` is missing or not logged in, or the network is down.

## 9. Hand over

Tell the person:

- the repository URL, and that `TARGET` is their first clone;
- with an App, that the App key is in `~/.github-app/$OWNER/$REPO/`. Every machine that runs the
  Target's dev container needs that key in the same place;
- without an App, that changes are made on the host under their own account, and that the dev
  container cannot push;
- that each machine working in the project runs Bootstrap next. On the host, that is
  `mise run bootstrap` in the clone.
