# Builds the Template image and runs isolated checks against the working tree or a revision.
# A host's personal Claude configuration could hide broken Template configuration; none is mounted.
#   pwsh -File tests/template/run.ps1 [-Ref revision] [-RequireAgent] [-NoCache] [-Selftest]
# Needs Docker (Rancher Desktop), git, network for the image/npm, and optional model credentials.
[CmdletBinding()]
param([string]$Ref, [switch]$RequireAgent, [switch]$NoCache, [switch]$Selftest)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$source = $root
$worktree = $null
$image = 'asdlc-template-test:local'
try {
    try {
        & docker info *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Docker info failed.' }
    } catch { throw 'Docker cannot be reached. Start Rancher Desktop and try again.' }
    if ($Ref) {
        $worktree = Join-Path ([System.IO.Path]::GetTempPath()) ('template-test-' + [guid]::NewGuid())
        & git -C $root worktree add --detach $worktree $Ref
        if ($LASTEXITCODE -ne 0) { throw "Could not check out revision: $Ref" }
        $source = $worktree
    }
    $commit = (& git -C $source rev-parse HEAD).Trim()
    $dirty = [bool](& git -C $source status --porcelain)
    $runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + $commit.Substring(0, 8)
    $out = Join-Path $PSScriptRoot "out/$runId"
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    $buildArgs = @('build', '-t', $image, '-f', "$source/template/.devcontainer/Dockerfile")
    if ($NoCache) { $buildArgs += '--no-cache' }
    & docker @buildArgs "$source/template" 2>&1 | Tee-Object -FilePath "$out/image-build.log"
    if ($LASTEXITCODE -ne 0) { throw "Image build failed. See $out/image-build.log" }
    $imageId = (& docker image inspect $image --format '{{.Id}}').Trim()
    $script = if ($Selftest) { 'selftest.sh' } else { 'steps.sh' }
    $runArgs = @('run', '--rm', '--init', '--entrypoint', 'sh', '--tmpfs', '/work:exec,uid=1000,gid=1000',
        '-v', "${source}:/src:ro", '-v', "${PSScriptRoot}:/tests:ro", '-v', "${out}:/out", '-w', '/src/template',
        '-e', 'TEMPLATE_TEST_HARNESS_ROOT=/tests',
        '-e', 'MISE_TRUSTED_CONFIG_PATHS=/src/template:/work', '-e', 'CLAUDE_CONFIG_DIR=/work/claude',
        '-e', 'DISABLE_AUTOUPDATER=1', '-e', "TEMPLATE_TEST_COMMIT=$commit", '-e', "TEMPLATE_TEST_DIRTY=$dirty",
        '-e', "TEMPLATE_TEST_IMAGE=$imageId", '-e', "TEMPLATE_TEST_REQUIRE_AGENT=$([int][bool]$RequireAgent)")
    if ($worktree) {
        # A linked worktree's .git file names this absolute host directory. Keep its index and
        # objects readable at that same path while the checkout itself is mounted at /src.
        $commonGitDirectory = (& git -C $source rev-parse --path-format=absolute --git-common-dir).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Could not locate the revision worktree Git metadata.' }
        $runArgs += @('-v', "${commonGitDirectory}:${commonGitDirectory}:ro")
    }
    foreach ($name in @('ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'TEMPLATE_TEST_DEPLOY', 'TEMPLATE_TEST_MODEL',
        'TEMPLATE_TEST_CANARY_SECONDS', 'TEMPLATE_TEST_CANARY_TURNS', 'TEMPLATE_TEST_CANARY_USD',
        'TEMPLATE_TEST_WORK_SECONDS', 'TEMPLATE_TEST_WORK_TURNS', 'TEMPLATE_TEST_WORK_USD')) {
        if ([Environment]::GetEnvironmentVariable($name)) { $runArgs += @('-e', $name) }
    }
    & docker @runArgs $image -c "mise exec -- sh /tests/$script"
    $result = $LASTEXITCODE
    Write-Output "Artifacts: $out"
    exit $result
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($worktree -and (Test-Path "$worktree/.git")) {
        & git -C $root worktree remove --force $worktree
    }
}
