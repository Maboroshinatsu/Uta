$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$workspaceRoot = if ($env:UTA_WORKSPACE_ROOT) { [IO.Path]::GetFullPath($env:UTA_WORKSPACE_ROOT) } else { Join-Path (Split-Path $repoRoot -Parent) 'Uta-Workspace' }
$recordFile = Join-Path $workspaceRoot 'operations\stable.json'
if (-not (Test-Path -LiteralPath $recordFile)) { throw 'No accepted ZIP release has been registered. Ask Codex to package and verify a release first.' }
$record = Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json
$exePath = [IO.Path]::GetFullPath($record.exe)
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'artifacts')) + [IO.Path]::DirectorySeparatorChar
if (-not $exePath.StartsWith($artifactRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($exePath) -ne 'Uta.exe' -or -not (Test-Path -LiteralPath $exePath)) { throw 'The accepted Uta.exe is missing or outside the release directory.' }
# Stable startup never inherits a development profile from the caller's terminal.
foreach ($name in @('UTA_PROFILE', 'UTA_USER_DATA_DIR', 'UTA_RUNTIME_DIR', 'UTA_ENDPOINT_FILE', 'DESKPET_ENDPOINT_FILE', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
$logDir = Join-Path $workspaceRoot 'operations\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-ffff'
$process = Start-Process -FilePath $exePath -WorkingDirectory (Split-Path $exePath -Parent) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "stable-$stamp.out.log") -RedirectStandardError (Join-Path $logDir "stable-$stamp.err.log") -PassThru
if ($process.WaitForExit(1500) -and $process.ExitCode -ne 0) { throw "Uta exited during startup ($($process.ExitCode)). Check $logDir" }
