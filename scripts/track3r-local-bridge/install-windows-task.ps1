param(
  [string]$TaskName = "ToDoGreen Track3r Local Bridge"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$Runner = Join-Path $ScriptDir "run-sync.cmd"
$Config = Join-Path $ScriptDir "config.local.json"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js não encontrado. Instale Node.js antes de registrar a tarefa."
}

if (-not (Test-Path $Config)) {
  throw "config.local.json não encontrado em $ScriptDir. Copie config.example.json e preencha antes de continuar."
}

if ([string]::IsNullOrWhiteSpace($env:TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET)) {
  throw "Defina TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET no Windows antes de registrar a tarefa."
}

Push-Location $RepoRoot
try {
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
    npm install
  }
  npx playwright install chromium
} finally {
  Pop-Location
}

$TaskCommand = '"' + $Runner + '"'
& schtasks.exe /Create /TN $TaskName /TR $TaskCommand /SC MINUTE /MO 10 /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "O Windows não conseguiu registrar a tarefa agendada."
}

Write-Host "Tarefa registrada: $TaskName"
Write-Host "Frequência: a cada 10 minutos"
Write-Host "Runner: $Runner"
Write-Host "Antes da primeira execução automática, rode: npm run track3r:login"
