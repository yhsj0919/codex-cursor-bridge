param([string]$WorkspaceRoot)
$ErrorActionPreference = 'Stop'

function Get-LocalizedText([string]$Value) {
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

try {
  $root = Split-Path -Parent $PSScriptRoot
  Set-Location $root
  $Host.UI.RawUI.WindowTitle = Get-LocalizedText 'Q29kZXggQ3Vyc29yIEJyaWRnZSDmjqfliLblj7DlkK/liqg='
  Write-Host (Get-LocalizedText '5q2j5Zyo5qOA5p+l6L+Q6KGM546v5aKDLi4u') -ForegroundColor Cyan

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw (Get-LocalizedText '5pyq5om+5YiwIE5vZGUuanPvvIzor7flhYjlronoo4UgTm9kZS5qcyAyMiDmiJbmm7Tpq5jniYjmnKzjgII=')
  }
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { $npm = Get-Command npm -ErrorAction Stop }

  if (-not (Test-Path 'node_modules\.package-lock.json')) {
    Write-Host (Get-LocalizedText '5qOA5rWL5Yiw5L6d6LWW5bCa5pyq5a6J6KOF77yM5q2j5Zyo5omn6KGMIG5wbSBpbnN0YWxsLi4u') -ForegroundColor Yellow
    & $npm.Source install
    if ($LASTEXITCODE -ne 0) { throw (Get-LocalizedText '5L6d6LWW5a6J6KOF5aSx6LSl44CC') }
  }

  Write-Host (Get-LocalizedText '5q2j5Zyo5p6E5bu6IEJyaWRnZS4uLg==') -ForegroundColor Cyan
  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { throw (Get-LocalizedText 'QnJpZGdlIOaehOW7uuWksei0peOAgg==') }

  Write-Host (Get-LocalizedText '5q2j5Zyo5qOA5p+lIEN1cnNvciDnmbvlvZXlkozmqKHlnovliJfooaguLi4=') -ForegroundColor Cyan
  & agent --list-models *> $null
  if ($LASTEXITCODE -ne 0) {
    throw (Get-LocalizedText 'Q3Vyc29yIOWwmuacqueZu+W9leaIluaXoOazleiOt+WPluaooeWei+OAguivt+WFiOi/kOihjCBhZ2VudCBsb2dpbuOAgg==')
  }

  if ($WorkspaceRoot) { $env:CURSOR_BRIDGE_WORKSPACE = (Resolve-Path $WorkspaceRoot).Path }
  elseif (-not $env:CURSOR_BRIDGE_WORKSPACE) { $env:CURSOR_BRIDGE_WORKSPACE = $root }

  Write-Host (Get-LocalizedText '5q2j5Zyo5Lul5YmN5Y+w5qih5byP5ZCv5YqoIEJyaWRnZeOAguaMiSBDdHJsK0Mg5YGc5q2i44CC') -ForegroundColor Green
  Write-Host "$(Get-LocalizedText '5bel5L2c5Yy6'): $env:CURSOR_BRIDGE_WORKSPACE"
  & $node.Source dist\main.js
  if ($LASTEXITCODE -ne 0) { throw "Bridge exited with code $LASTEXITCODE" }
} catch {
  Write-Host "$(Get-LocalizedText '5ZCv5Yqo5aSx6LSl'): $($_.Exception.Message)" -ForegroundColor Red
  Read-Host (Get-LocalizedText '5oyJ5Zue6L2m6ZSu6YCA5Ye6') | Out-Null
  exit 1
}
