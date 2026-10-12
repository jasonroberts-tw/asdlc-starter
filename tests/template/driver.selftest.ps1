# Checks Docker preflight refusals without a Docker installation or running engine.
# A missing executable must explain the same recovery as an unreachable daemon.
#   pwsh -NoProfile -File tests/template/driver.selftest.ps1
# Runs isolated child PowerShell processes; writes no project files and makes no model calls.
$ErrorActionPreference = 'Stop'
$driver = (Join-Path $PSScriptRoot 'run.ps1').Replace("'", "''")
foreach ($case in @(
    @{ Name = 'missing Docker command'; Mock = 'throw "unavailable"' },
    @{ Name = 'unreachable Docker daemon'; Mock = '$global:LASTEXITCODE = 1' }
)) {
    $command = 'function docker { ' + $case.Mock + " }; & '$driver' -Selftest"
    $output = & pwsh -NoProfile -Command $command 2>&1 | Out-String
    if ($LASTEXITCODE -ne 1 -or $output -notmatch 'Docker cannot be reached\. Start Rancher Desktop and try again\.') {
        throw "FAIL $($case.Name): expected exit 1 and Docker recovery instructions, got $LASTEXITCODE`n$output"
    }
    Write-Output "PASS $($case.Name)"
}
