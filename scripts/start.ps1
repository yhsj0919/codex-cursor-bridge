param([string]$WorkspaceRoot)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$Host.UI.RawUI.WindowTitle = 'Codex Cursor Bridge'
if (-not (Test-Path 'dist\main.js')) { throw '未找到 dist\main.js，请先运行 npm install 和 npm run build。' }
$agent = Join-Path $env:LOCALAPPDATA 'cursor-agent\agent.cmd'
if (-not (Test-Path $agent)) { throw "找不到 Cursor Agent：$agent" }
Write-Host '正在检查 Cursor 登录和模型列表...'
& $agent --list-models *> $null
if ($LASTEXITCODE -ne 0) { throw 'Cursor 尚未登录或无法获取模型。请先运行 agent login。' }
if ($WorkspaceRoot) { $env:CURSOR_BRIDGE_WORKSPACE = (Resolve-Path $WorkspaceRoot).Path }
elseif (-not $env:CURSOR_BRIDGE_WORKSPACE) { $env:CURSOR_BRIDGE_WORKSPACE = $root }
node dist\main.js
