#!/usr/bin/env bash
# The container's own clone of the repository, made at the first start in the workspace volume
# devcontainer.json mounts, since no host checkout is mounted, and then
# the setup steps that cannot be image layers, because each one reads that clone and it does
# not exist at build time:
#
#   1. `npm ci`                   -- node_modules holds native binaries, so it belongs to the
#                                    container's platform, not the host's. This is also why
#                                    README.md tells people never to share a clone between Windows
#                                    and WSL.
#   2. the git hooks              -- the five `hook.asdlc-*` entries in the repository's config,
#                                    which run scripts/git-hooks.mjs at each event.
#   3. the beads issue database   -- a Dolt DB under .beads/embeddeddolt/, not in git.
#
# ...a warning when the image's tools lag `mise.toml`, since it installs none, and a warning when Vale
# cannot load `.vale.ini`. Its styles are what `vale sync` downloads into the
# repository, once, and a person runs it (.devcontainer/README.md): this script does not...
#
# ...and a check that the agents' GitHub App, as which the container's `git` and `gh` act, can mint
# a token, which is here for the same reason: it depends on the key devcontainer.json mounts from
# the host, which is unknown at build time. With it, the App's bot account set as git's commit
# identity when none is, read from the clone's policy, which the image cannot see either.
#
#
# ...and Claude Code's status line, .devcontainer/statusline.sh, set in the settings in that volume
# when they set none, for the first reason: a volume made before the image changed keeps what it held.
#
# Wired to ENTRYPOINT by the Dockerfile so that devcontainer.json needs no lifecycle command. Runs
# on every container start, which is why every step below is idempotent and cheap when there is
# nothing to do.
#
# Nothing here is allowed to fail the container. This is the process that starts the shell you would
# use to fix a setup problem; exiting non-zero would lock you out of it. Every step warns and
# carries on.

set -uo pipefail

log() { printf '\033[36m[devcontainer]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[devcontainer]\033[0m %s\n' "$*"; }

# The clone, once setup() has found it; plugins() installs into it.
workspace=''

# The copy of the policy record the Dockerfile puts in the image, which names the repository clone()
# clones: the clone's own copy does not exist yet. WORKSPACE_ENTRYPOINT_POLICY names a doctored copy,
# as scripts/github-app-token.mjs's selftest sets it.
policy="${WORKSPACE_ENTRYPOINT_POLICY:-/usr/local/share/workspace-entrypoint/tool-settings.json}"

# take_ownership <dir>: a volume Docker creates for a path the image lacks arrives root-owned, and
# Claude Code or git then fails on a write it should have been able to make. `vscode` has
# passwordless sudo in this base image.
take_ownership() {
  if [ -d "$1" ] && [ ! -w "$1" ]; then
    warn "taking ownership of $1 (the volume arrived root-owned)"
    sudo chown -R "$(id -u):$(id -g)" "$1" 2>/dev/null || warn "chown $1 failed"
  fi
}

# The first start clones the repository into REPO_WORKSPACE, the workspace volume, over HTTPS with
# no token, since the repository is public; later pushes go through the App's credential helper,
# which runs from this clone. A start that finds a clone there, with a commit checked out, leaves it
# as it is: a session pulls. One that finds `.git` and no commit, a first start killed mid-clone,
# says so, since every step after this would otherwise skip what the clone lacks without a word.
# Fails, after a warning, when the clone cannot be made or is unfinished, and setup() then stops,
# since every step after it reads the clone. scripts/github-app-token.mjs's selftest runs it.
clone() {
  local repo="${REPO_WORKSPACE:-}" slug
  if [ -z "$repo" ]; then
    return 0
  fi
  if [ -e "$repo/.git" ]; then
    if git -C "$repo" rev-parse --verify --quiet HEAD >/dev/null; then
      return 0
    fi
    warn "$repo holds an unfinished clone, with no commit checked out -- remove the workspace volume and start again"
    return 1
  fi
  take_ownership "$repo"
  if ! slug="$(jq -er 'select((.githubAppRepositoryOwner | type) == "string" and (.githubAppTokenRepository | type) == "string") | "\(.githubAppRepositoryOwner)/\(.githubAppTokenRepository)"' "$policy" 2>/dev/null)"; then
    warn "cannot clone: $policy names no githubAppRepositoryOwner and githubAppTokenRepository -- rebuild the container"
    return 1
  fi
  log "cloning https://github.com/$slug into $repo"
  if ! git clone --quiet "https://github.com/$slug.git" "$repo"; then
    warn "cloning https://github.com/$slug failed -- run \`git clone https://github.com/$slug.git $repo\` once the network is back"
    return 1
  fi
}

# TODO: templatize the repo name
setup() {
  clone || return 0
  local repo="${REPO_WORKSPACE:-}"

  # Which mounted directory is this repository? Named by package.json rather than by path, because
  # the mount point is the clone's directory name and people clone into whatever they like. The
  # marker is package.json's "name", "asdlc-openspec": a rename there is a rename here. Until
  # 2026-09-25 this matched the placeholder "<package-name>", which no package.json carried, so
  # every container skipped setup with a warning that read like a mount problem (asdlc-openspec-opg).
  if [ -z "$repo" ]; then
    local candidate
    for candidate in /workspaces/*/; do
      if grep -Eqs '"name"[[:space:]]*:[[:space:]]*"asdlc-openspec"' "${candidate}package.json"; then
        repo="${candidate%/}"
        break
      fi
    done
  fi

  if [ -z "$repo" ] || [ ! -d "$repo" ]; then
    warn 'workspace not found; skipping setup (set REPO_WORKSPACE if it is mounted elsewhere)'
    return 0
  fi

  cd "$repo" || return 0
  workspace="$repo"

  # The image installed the toolchain from `mise.toml` and `mise.lock` when it was built (the
  # Dockerfile), so a pin moved since then is missing here, and mise would install it over the
  # network at its first use. Say so, and install nothing: a rebuild is the fix.
  if command -v mise >/dev/null 2>&1 && [ -n "$(mise ls --current --missing --no-header 2>/dev/null)" ]; then
    warn 'a tool mise.toml pins is missing from this image -- rebuild the container (`mise ls --missing` names it)'
  fi

  # `npm ci`, but only when it would change something. The marker records the lockfile hash the
  # current node_modules was installed from, so a rebuild after a dependency bump reinstalls, and an
  # ordinary container restart costs one checksum. `ci` and not `install`: package-lock.json is
  # authoritative and CI installs the same way.
  local marker='node_modules/.devcontainer-lock-hash'
  local want have
  want="$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)"
  have="$(cat "$marker" 2>/dev/null)"
  if [ -n "$want" ] && [ "$want" != "$have" ]; then
    log 'npm ci'
    if npm ci; then
      printf '%s' "$want" >"$marker"
    else
      warn 'npm ci failed -- fix the cause and run it again yourself'
    fi
  fi

  # The git hooks (docs/decisions.md § D-19). `npm ci` above runs this install through
  # package.json's `prepare`; it runs again here because a start that skipped `npm ci` would
  # otherwise leave a clone with no hooks. `bd hooks install` is not run: the tracker's jobs in
  # git-hooks.yml are its git integration, and a section bd wrote into .git/hooks would run bd a
  # second time after them (docs/decisions.md § D-22).
  if [ -f scripts/git-hooks.mjs ]; then
    node scripts/git-hooks.mjs --install >/dev/null 2>&1 \
      || warn 'installing the git hooks failed -- run `mise run hooks:install` to see why'
  fi

  # The Dolt remote is already configured in .beads/config.yaml (refs/dolt/data on the GitHub
  # remote), so hydrating needs the App's token, which git reaches through the image's credential
  # helper. Until the App's key is mounted it cannot work, which is a hint and not an error. Never
  # `bd init` -- that creates a new tracker rather than joining this one.
  if [ ! -d .beads/embeddeddolt ]; then
    log 'hydrating the beads issue database'
    bd bootstrap >/dev/null 2>&1 \
      || warn 'bd bootstrap failed -- once the GitHub App mints a token (a warning below says so if it cannot), run `bd bootstrap` (never `bd init`)'
  fi

}

# The container's `git` and `gh` act as the agents' GitHub App, through the wrappers the Dockerfile
# installs (docs/decisions.md § D-51); this checks they can, at start, rather than at a session's
# first push. Each check exists because the corresponding failure is silent and looks like something
# else.
credentials() {
  # A new volume takes the image's ~/.claude as it is, owned by `vscode`; one the daemon made before
  # the image had that directory arrives root-owned.
  take_ownership "$HOME/.claude"

  # The App's key comes from the host, and a missing one fails every push, `gh` call and tracker pull
  # in a way that reads as a network fault. The helper's own message says which: no directory, no
  # key, two keys, or GitHub's refusal. A token minted here is kept, so the session's first command
  # does not wait for one.
  if [ -n "$workspace" ] && ! (cd "$workspace" && node scripts/github-app-token.mjs token >/dev/null); then
    warn 'the GitHub App could not mint a token, so git and gh cannot reach GitHub -- .devcontainer/README.md says how to give the container its key'
  fi

  commit_identity
}

# ~/.gitconfig is the container's own, which a rebuild discards, so a commit made here has no
# identity until one is set. The container's sessions act as the agents' GitHub App, so whenever
# ~/.gitconfig holds no user.email, this sets user.name and user.email to the App's bot account
# (`githubAppBot*`, through `scripts/github-app-token.mjs identity`); an email already there, set by
# a person or an earlier start, is left with its name. Only those two keys are taken from the
# helper's lines. scripts/github-app-token.mjs's selftest runs this function, sourcing this file with
# ENTRYPOINT_FUNCTIONS_ONLY=1 (the end of this file).
commit_identity() {
  if [ -z "$(git config --global user.email)" ]; then
    local identity key value
    if [ -n "$workspace" ] && identity="$(cd "$workspace" && node scripts/github-app-token.mjs identity)"; then
      while IFS='=' read -r key value; do
        case "$key" in
          user.name | user.email) git config --global "$key" "$value" || warn "git config --global $key failed" ;;
        esac
      done <<<"$identity"
      if [ -n "$(git config --global user.email)" ]; then
        log "committing as $(git config --global user.name) <$(git config --global user.email)>"
      else
        warn "git identity unset: scripts/github-app-token.mjs identity gave no user.email"
      fi
    else
      warn "git identity unset, and the App's could not be read -- run \`node scripts/github-app-token.mjs identity\` in the clone to see why"
    fi
  fi

  # The clone's own .git/config outranks ~/.gitconfig, so an email set there, by a session or a person
  # in the container, is the one the container's commits carry, whatever was set above.
  if [ -n "$workspace" ] && [ -n "$(git -C "$workspace" config --local user.email)" ]; then
    warn "the clone's own .git/config sets user.email, so commits here carry $(git -C "$workspace" config --local user.email), not the App's"
  fi
}

# TODO: vendor-harness specific
plugins() {
  if [ -z "$workspace" ] || ! cd "$workspace" 2>/dev/null; then
    return 0
  fi
  # Listed once each, so a start with everything in place costs two calls. plugin() reads both.
  local markets installed
  markets="$(claude plugin marketplace list --json 2>/dev/null)"
  installed="$(claude plugin list --json 2>/dev/null)"
  plugin beads-marketplace gastownhall/beads beads@beads-marketplace
  plugin agent-tools vale-cli/agent-tools vale@agent-tools
}

# plugin <marketplace> <its source> <plugin id>: register the marketplace when ~/.claude lacks it,
# then install the plugin at project scope when no record names this clone.
#
# Of the `--json` fields read below, a marketplace's `.name` and an installed plugin's `.id` and
# `.scope` were read from a real `claude`, for a user-scope install of Langfuse's plugin under a
# throwaway CLAUDE_CONFIG_DIR (verified against the CLI, 2.1.295, asdlc-openspec-ic9h.8). A
# project-scope record's `.projectPath` is NOT VERIFIED against one: its one source is Claude Code's
# plugin commands reference (§ plugin list), which asdlc-openspec-xw8z cites. A field misnamed reads
# as absent, so each start would add the marketplace again or reinstall the plugin and log it, which
# xw8z's second start would show.
plugin() {
  local market="$1" source="$2" id="$3"
  if ! printf '%s' "$markets" | jq -e --arg m "$market" 'any(.[]; .name == $m)' >/dev/null 2>&1; then
    if ! claude plugin marketplace add "$source" >/dev/null 2>&1; then
      warn "could not add the $market plugin marketplace -- \`claude plugin marketplace add $source\`"
      return 0
    fi
  fi
  if ! printf '%s' "$installed" | jq -e --arg id "$id" --arg path "$PWD" \
    'any(.[]; .id == $id and .scope == "project" and .projectPath == $path)' >/dev/null 2>&1; then
    log "installing the $id plugin for this clone"
    claude plugin install "$id" --scope project >/dev/null 2>&1 \
      || warn "could not install the $id plugin -- run \`claude plugin install $id --scope project\` in $PWD"
  fi
}

# Claude Code's status line, run from the clone so an edit to the script needs no rebuild, set as
# `statusLine` in the volume's settings.json only while that file sets none: a status line a person
# sets in the container stays, and one deleted comes back at the next start. A file jq cannot read
# is left as it is; one missing, empty or of whitespace alone reads as `{}` through
# `first(inputs) // {}`, where `.` would print nothing and the write would empty the file. It runs
# after credentials(), which makes ~/.claude writable. scripts/github-app-token.mjs's selftest runs it.
statusline() {
  local settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" current next
  if [ -z "$workspace" ] || [ ! -f "$workspace/.devcontainer/statusline.sh" ]; then
    return 0
  fi
  current="$(cat "$settings" 2>/dev/null)"
  if printf '%s' "$current" | jq -e 'has("statusLine")' >/dev/null 2>&1; then
    return 0
  fi
  if next="$(printf '%s' "$current" | jq -n --arg command "sh '$workspace/.devcontainer/statusline.sh'" \
    'first(inputs) // {} | . + {statusLine: {type: "command", command: $command}}' 2>/dev/null)" \
    && printf '%s\n' "$next" >"$settings.tmp" && mv "$settings.tmp" "$settings"; then
    log "status line set in $settings"
  else
    rm -f "$settings.tmp"
    warn "could not set the status line in $settings -- is it valid JSON?"
  fi
}

# Sourced with ENTRYPOINT_FUNCTIONS_ONLY=1, as scripts/github-app-token.mjs's selftest sources it to
# run clone, commit_identity, tracing and statusline, this file defines its functions and runs none
# of its steps.
if [ "${ENTRYPOINT_FUNCTIONS_ONLY:-}" = 1 ]; then
  return 0
fi

setup || true
credentials || true
#plugins || true
statusline || true

# Last, so that anything above it reads as a warning about a container that is otherwise ready.
log 'ready: bd ready | mise run gates | claude'

exec "$@"
