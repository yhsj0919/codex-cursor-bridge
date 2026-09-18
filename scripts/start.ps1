param([string]$WorkspaceRoot)
$ErrorActionPreference = 'Stop'

function Get-LocalizedText([string]$Value) {
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

$textJson = Get-LocalizedText 'eyJ0aXRsZSI6IkNvZGV4IEN1cnNvciBCcmlkZ2Ug566h55CG5bel5YW3Iiwic3RhcnQiOiJbMV0g5ZCv5YqoIEJyaWRnZe+8iOWQjuWPsOi/kOihjO+8iSIsInN0b3AiOiJbMl0g5YGc5q2iIEJyaWRnZSIsInN0YXR1cyI6IlszXSDmn6XnnIvov5DooYznirbmgIEiLCJyZXN0YXJ0IjoiWzRdIOmHjeWQryBCcmlkZ2UiLCJlbnZpcm9ubWVudCI6Ils1XSDnjq/looMv5a6J6KOF5qOA5rWLIiwibW9kZWxzIjoiWzZdIOafpeeci+WPr+eUqOaooeWeiyIsImFwaSI6Ils3XSDmtYvor5UgQVBJIiwibG9ncyI6Ils4XSDmn6XnnIvmnIDov5Hml6Xlv5ciLCJleGl0IjoiWzBdIOmAgOWHuiIsInNlbGVjdCI6Iuivt+mAieaLqSIsInJldHVybiI6IuaMieWbnui9pumUrui/lOWbnuiPnOWNlSIsImludmFsaWQiOiLml6DmlYjpgInmi6njgIIiLCJydW5uaW5nIjoi6L+Q6KGM54q25oCB77ya5q2j5Zyo6L+Q6KGMIiwibm90UnVubmluZyI6Iui/kOihjOeKtuaAge+8muacqui/kOihjCIsInVubWFuYWdlZCI6IuajgOa1i+WIsCBBUEkg5q2j5Zyo6L+Q6KGM77yM5L2G5LiN5piv55Sx5pys5bel5YW35ZCv5Yqo77yM5peg5rOV5a6J5YWo5YGc5q2i44CCIiwic3RhcnRpbmciOiLmraPlnKjlkI7lj7DlkK/liqggQnJpZGdlLi4uIiwic3RhcnRlZCI6IkJyaWRnZSDlkK/liqjmiJDlip8iLCJhbHJlYWR5UnVubmluZyI6IkJyaWRnZSDlt7Lnu4/lnKjov5DooYzjgIIiLCJzdGFydEZhaWxlZCI6IkJyaWRnZSDlkK/liqjlpLHotKXvvIzor7fmn6XnnIvml6Xlv5fjgIIiLCJzdG9wcGluZyI6Iuato+WcqOWBnOatoiBCcmlkZ2UuLi4iLCJzdG9wcGVkIjoiQnJpZGdlIOW3suWBnOatouOAgiIsIm1pc3NpbmdCdWlsZCI6IuacquaJvuWIsCBkaXN0L21haW4uanPvvIzor7flhYjov5DooYwgbnBtIGluc3RhbGwg5ZKMIG5wbSBydW4gYnVpbGTjgIIiLCJjaGVja2luZyI6Iuato+WcqOajgOafpeeOr+Wigy4uLiIsIndvcmtzcGFjZSI6IuW3peS9nOWMuiIsInBvcnQiOiLnq6/lj6MiLCJwaWQiOiLov5vnqIsgSUQiLCJub2RlIjoiTm9kZS5qcyIsImFnZW50IjoiQ3Vyc29yIEFnZW50IiwiYnVpbGQiOiJCcmlkZ2Ug5p6E5bu6Iiwib2siOiLmraPluLgiLCJmYWlsZWQiOiLlpLHotKUiLCJtb2RlbHNVbmF2YWlsYWJsZSI6IkJyaWRnZSDmnKrov5DooYzvvIzml6Dms5Xor7vlj5bop4TojIPljJbmqKHlnovliJfooajjgIIiLCJtb2RlbHNUaXRsZSI6IuWPr+eUqOaooeWeiyIsImFwaU9rIjoiQVBJIOa1i+ivlemAmui/h+OAgiIsImFwaUZhaWxlZCI6IkFQSSDmtYvor5XlpLHotKUiLCJub0xvZ3MiOiLmmoLml6Dml6Xlv5fjgIIiLCJzdGRvdXQiOiLmoIflh4bovpPlh7oiLCJzdGRlcnIiOiLplJnor6/ovpPlh7oiLCJwcm9jZXNzSW52YWxpZCI6IlBJRCDmlofku7blt7LlpLHmlYjmiJbov5vnqIvkuI3lsZ7kuo4gQnJpZGdl77yM5bey5riF55CG6K6w5b2V44CCIn0='
$Text = $textJson | ConvertFrom-Json
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$runtimeDir = Join-Path $root '.bridge-runtime'
$pidPath = Join-Path $runtimeDir 'bridge.pid'
$stdoutPath = Join-Path $runtimeDir 'bridge.out.log'
$stderrPath = Join-Path $runtimeDir 'bridge.err.log'
$port = if ($env:CURSOR_BRIDGE_PORT) { [int]$env:CURSOR_BRIDGE_PORT } else { 8765 }
$workspace = if ($WorkspaceRoot) { (Resolve-Path $WorkspaceRoot).Path } elseif ($env:CURSOR_BRIDGE_WORKSPACE) { (Resolve-Path $env:CURSOR_BRIDGE_WORKSPACE).Path } else { $root }
$env:CURSOR_BRIDGE_WORKSPACE = $workspace

function Test-BridgeApi {
  try { $null = Invoke-RestMethod "http://127.0.0.1:$port/healthz" -TimeoutSec 2; return $true }
  catch { return $false }
}

function Get-BridgeProcess {
  if (-not (Test-Path $pidPath)) { return $null }
  $savedPid = 0
  if (-not [int]::TryParse((Get-Content -Raw $pidPath).Trim(), [ref]$savedPid)) { Remove-Item $pidPath -Force; return $null }
  $process = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  $details = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
  if (-not $process -or -not $details -or $details.Name -ne 'node.exe' -or $details.CommandLine -notmatch 'dist[\\/]main\.js') {
    Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
    return $null
  }
  return $process
}

function Show-Status {
  $process = Get-BridgeProcess
  if ($process) {
    Write-Host $Text.running -ForegroundColor Green
    Write-Host "$($Text.pid): $($process.Id)"
    Write-Host "$($Text.port): $port"
    Write-Host "$($Text.workspace): $workspace"
  } elseif (Test-BridgeApi) { Write-Host $Text.unmanaged -ForegroundColor Yellow }
  else { Write-Host $Text.notRunning -ForegroundColor DarkGray }
}

function Start-Bridge {
  if (Get-BridgeProcess) { Write-Host $Text.alreadyRunning -ForegroundColor Yellow; return }
  if (Test-BridgeApi) { Write-Host $Text.unmanaged -ForegroundColor Yellow; return }
  if (-not (Test-Path 'dist\main.js')) { Write-Host $Text.missingBuild -ForegroundColor Red; return }
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  Write-Host $Text.starting
  $process = Start-Process -FilePath $nodePath -ArgumentList 'dist\main.js' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  [IO.File]::WriteAllText($pidPath, [string]$process.Id, [Text.Encoding]::ASCII)
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-BridgeApi) { Write-Host "$($Text.started) (PID $($process.Id))" -ForegroundColor Green; return }
    if ($process.HasExited) { break }
  }
  Write-Host $Text.startFailed -ForegroundColor Red
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 20 }
}

function Stop-Bridge {
  $process = Get-BridgeProcess
  if (-not $process) {
    if (Test-BridgeApi) { Write-Host $Text.unmanaged -ForegroundColor Yellow } else { Write-Host $Text.notRunning -ForegroundColor DarkGray }
    return
  }
  Write-Host $Text.stopping
  & taskkill.exe /PID $process.Id /T /F *> $null
  Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
  Write-Host $Text.stopped -ForegroundColor Green
}

function Test-Environment {
  Write-Host (Get-LocalizedText '546v5aKD5qOA5rWL5oql5ZGK') -ForegroundColor Cyan
  Write-Host '============================================================'
  Write-Host "$(Get-LocalizedText '5pON5L2c57O757uf'): $([Environment]::OSVersion.VersionString)"
  Write-Host "$(Get-LocalizedText 'UG93ZXJTaGVsbA=='): $($PSVersionTable.PSVersion)"
  Write-Host "$(Get-LocalizedText '6aG555uu55uu5b2V'): $root"
  Write-Host "$($Text.workspace): $workspace"
  Write-Host "$($Text.port): $port"

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { Write-Host "$($Text.node): $(& $nodeCommand.Source --version) ($($nodeCommand.Source))" -ForegroundColor Green }
  else { Write-Host "$($Text.node): $($Text.failed)" -ForegroundColor Red }

  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
  if ($npmCommand) { Write-Host "npm: $(& $npmCommand.Source --version) ($($npmCommand.Source))" -ForegroundColor Green }
  else { Write-Host (Get-LocalizedText '5pyq5om+5YiwIG5wbeOAgg==') -ForegroundColor Red }

  $agentCommand = Get-Command agent -ErrorAction SilentlyContinue
  if ($agentCommand) {
    Write-Host "$($Text.agent): $($agentCommand.Source)" -ForegroundColor Green
    & $agentCommand.Source --version
    & $agentCommand.Source status
    $rawModels = & $agentCommand.Source --list-models 2>$null
    $rawCount = @($rawModels | Where-Object { $_ -match '^\S+\s+-\s+' }).Count
    Write-Host "Cursor $($Text.modelsTitle): $rawCount"
  } else { Write-Host "$($Text.agent): $($Text.failed)" -ForegroundColor Red }

  Write-Host "$(Get-LocalizedText '5L6d6LWW5a6J6KOF'): $(if (Test-Path 'node_modules\.package-lock.json') { $Text.ok } else { $Text.failed })"
  Write-Host "$($Text.build): $(if (Test-Path 'dist\main.js') { $Text.ok } else { $Text.failed })"
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
    Write-Host "$(Get-LocalizedText '55uR5ZCs6L+b56iL'): PID $($listener.OwningProcess), $($listenerProcess.Name)" -ForegroundColor Green
  } else { Write-Host "$(Get-LocalizedText '55uR5ZCs6L+b56iL'): $($Text.notRunning)" }

  if (Test-BridgeApi) {
    $modelResponse = Invoke-RestMethod "http://127.0.0.1:$port/v1/models" -TimeoutSec 10
    Write-Host "$(Get-LocalizedText 'QVBJIOeKtuaAgQ=='): $($Text.ok), $($Text.modelsTitle) $($modelResponse.data.Count)" -ForegroundColor Green
  } else { Write-Host "$(Get-LocalizedText 'QVBJIOeKtuaAgQ=='): $($Text.failed)" -ForegroundColor Yellow }
  if (Test-Path 'dist\codex\switch.js') { & node dist\codex\switch.js status }
  Write-Host '============================================================'
}

function Test-Api {
  try {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $health = Invoke-RestMethod "http://127.0.0.1:$port/healthz" -TimeoutSec 5
    $models = Invoke-RestMethod "http://127.0.0.1:$port/v1/models" -TimeoutSec 10
    $watch.Stop()
    Write-Host "$($Text.apiOk) status=$($health.status), $(Get-LocalizedText '5qih5Z6L5pWw6YeP')=$($models.data.Count), $(Get-LocalizedText '5ZON5bqU6ICX5pe2')=$($watch.ElapsedMilliseconds)ms" -ForegroundColor Green
  } catch { Write-Host "$($Text.apiFailed): $($_.Exception.Message)" -ForegroundColor Red }
}

function Install-OrUpdate {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
  if (-not $npmCommand) { Write-Host (Get-LocalizedText '5pyq5om+5YiwIG5wbeOAgg==') -ForegroundColor Red; return }
  try {
    Write-Host (Get-LocalizedText '5q2j5Zyo5a6J6KOF5oiW5pu05paw5L6d6LWWLi4u') -ForegroundColor Cyan
    & $npmCommand.Source install
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
    Write-Host (Get-LocalizedText '5q2j5Zyo6L+Q6KGM5a6M5pW05qOA5p+lLi4u') -ForegroundColor Cyan
    & $npmCommand.Source run check
    if ($LASTEXITCODE -ne 0) { throw 'npm run check failed' }
    & $npmCommand.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
    Write-Host (Get-LocalizedText '5a6J6KOFL+abtOaWsOWujOaIkOOAgg==') -ForegroundColor Green
  } catch { Write-Host "$(Get-LocalizedText '5a6J6KOFL+abtOaWsOWksei0pQ=='): $($_.Exception.Message)" -ForegroundColor Red }
}

function Show-Models {
  if (-not (Test-BridgeApi)) { Write-Host $Text.modelsUnavailable -ForegroundColor Yellow; return }
  $response = Invoke-RestMethod "http://127.0.0.1:$port/v1/models" -TimeoutSec 10
  Write-Host "$($Text.modelsTitle): $($response.data.Count)" -ForegroundColor Cyan
  $response.data | ForEach-Object { Write-Host "- $($_.id)" }
}

function Show-Logs {
  Write-Host "$(Get-LocalizedText '5pel5b+X55uu5b2V'): $runtimeDir" -ForegroundColor Cyan
  if (-not (Test-Path $stdoutPath) -and -not (Test-Path $stderrPath)) { Write-Host $Text.noLogs; return }
  if (Test-Path $stdoutPath) { Write-Host "--- $($Text.stdout) ---" -ForegroundColor Cyan; Get-Content $stdoutPath -Tail 50 }
  if (Test-Path $stderrPath) { Write-Host "--- $($Text.stderr) ---" -ForegroundColor Yellow; Get-Content $stderrPath -Tail 50 }
}

while ($true) {
  Clear-Host
  Write-Host '============================================================'
  Write-Host "               $($Text.title)" -ForegroundColor Cyan
  Write-Host '============================================================'
  Show-Status
  Write-Host ''
  Write-Host $Text.start
  Write-Host $Text.stop
  Write-Host $Text.status
  Write-Host $Text.restart
  Write-Host $Text.environment
  Write-Host $Text.models
  Write-Host $Text.api
  Write-Host $Text.logs
  Write-Host (Get-LocalizedText 'WzldIOWuieijheaIluabtOaWsCBCcmlkZ2U=')
  Write-Host (Get-LocalizedText 'WzEwXSDmqKHlnovmnaXmupDnrqHnkIY=')
  Write-Host $Text.exit
  Write-Host ''
  $choice = Read-Host $Text.select
  switch ($choice) {
    '1' { Start-Bridge }
    '2' { Stop-Bridge }
    '3' { Show-Status }
    '4' { Stop-Bridge; Start-Bridge }
    '5' { Test-Environment }
    '6' { Show-Models }
    '7' { Test-Api }
    '8' { Show-Logs }
    '9' { Install-OrUpdate }
    '10' { & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'switch.ps1') }
    '0' { exit 0 }
    default { Write-Host $Text.invalid -ForegroundColor Yellow }
  }
  Read-Host $Text.return | Out-Null
}
