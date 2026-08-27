param(
  [string]$AnttPackageUrl = "",
  [string]$AnttPackagePath = "",
  [string]$AnttDllUrl = "",
  [string]$AnttDllPath = "",
  [string]$AnttExeUrl = "",
  [string]$AnttExePath = "",
  [string]$DcsUrl = "",
  [string]$DcsPath = "",
  [string]$EnvironmentName = "Production",
  [string]$InstallRoot = "C:\ToDoGreen\AnttCiotConnector",
  [string]$AnttRoot = "C:\ANTT\CIOT",
  [string]$AnttExecutablePath = "",
  [string]$ListenUrl = "http://127.0.0.1:8088",
  [string]$PublicConnectorUrl = "",
  [string]$ConnectorToken = "",
  [string]$ErpEnvFile = "",
  [string]$ServiceName = "ToDoGreenAnttCiotConnector",
  [switch]$SuppressTokenOutput
)

$ErrorActionPreference = "Stop"

function New-Token {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  [Convert]::ToBase64String($bytes).TrimEnd("=")
}

function Require-Command($Name, $Message) {
  if (!(Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw $Message
  }
}

function Get-ArtifactExtension($Source, $DefaultExtension) {
  if ([string]::IsNullOrWhiteSpace($Source)) {
    return $DefaultExtension
  }

  $path = $Source
  if ($Source -match "^https?://") {
    $path = ([Uri]$Source).AbsolutePath
  }

  $extension = [System.IO.Path]::GetExtension($path)
  if ([string]::IsNullOrWhiteSpace($extension)) {
    return $DefaultExtension
  }

  return $extension
}

function Receive-Artifact($Url, $LocalPath, $Prefix, $DefaultExtension, $DownloadsDir) {
  if (![string]::IsNullOrWhiteSpace($Url) -and ![string]::IsNullOrWhiteSpace($LocalPath)) {
    throw "Informe apenas URL ou arquivo local para $Prefix, não ambos."
  }

  if (![string]::IsNullOrWhiteSpace($Url)) {
    $extension = Get-ArtifactExtension $Url $DefaultExtension
    $target = Join-Path $DownloadsDir ($Prefix + "-" + (Get-Date -Format "yyyyMMddHHmmss") + $extension)
    Write-Host "Baixando $Prefix..."
    Invoke-WebRequest -Uri $Url -OutFile $target
    return $target
  }

  if (![string]::IsNullOrWhiteSpace($LocalPath)) {
    if (!(Test-Path $LocalPath)) {
      throw "Arquivo informado para $Prefix não encontrado: $LocalPath"
    }

    $extension = Get-ArtifactExtension $LocalPath $DefaultExtension
    $target = Join-Path $DownloadsDir ($Prefix + "-" + (Get-Date -Format "yyyyMMddHHmmss") + $extension)
    Copy-Item $LocalPath $target -Force
    return $target
  }

  return ""
}

function Install-Artifact($ArtifactPath, $OfficialDir) {
  if ([string]::IsNullOrWhiteSpace($ArtifactPath)) {
    return ""
  }

  if ($ArtifactPath.ToLowerInvariant().EndsWith(".zip")) {
    $extractDir = Join-Path $OfficialDir ([System.IO.Path]::GetFileNameWithoutExtension($ArtifactPath))
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -Path $ArtifactPath -DestinationPath $extractDir -Force
    return $extractDir
  }

  $target = Join-Path $OfficialDir (Split-Path $ArtifactPath -Leaf)
  Copy-Item $ArtifactPath $target -Force
  return $target
}

function Find-FirstExe($Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or !(Test-Path $Path)) {
    return $null
  }

  $item = Get-Item $Path
  if (!$item.PSIsContainer) {
    if ($item.Extension -ieq ".exe") {
      return $item
    }
    return $null
  }

  return Get-ChildItem -Path $Path -Filter "*.exe" -Recurse | Select-Object -First 1
}

function Join-UrlPath($BaseUrl, $Path) {
  if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    return ""
  }

  return $BaseUrl.TrimEnd([char[]]"/") + "/" + $Path.TrimStart([char[]]"/")
}

function Protect-SecretFile($Path) {
  if ($env:OS -ne "Windows_NT") {
    return
  }

  if (!(Get-Command "icacls.exe" -ErrorAction SilentlyContinue)) {
    return
  }

  & icacls.exe $Path /inheritance:r | Out-Null
  & icacls.exe $Path /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" | Out-Null
}

Require-Command "dotnet" "Instale o .NET 8 SDK no servidor Windows antes de rodar este script."

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$projectDir = Resolve-Path (Join-Path $repoRoot "connectors\antt-ciot")
$projectFile = Join-Path $projectDir "ToDoGreen.AnttCiotConnector.csproj"
$publishDir = Join-Path $InstallRoot "app"
$secretsDir = Join-Path $InstallRoot "secrets"
$opsDir = Join-Path $InstallRoot "ops"
$officialDir = Join-Path $AnttRoot "official"
$downloadsDir = Join-Path $AnttRoot "downloads"

New-Item -ItemType Directory -Force -Path $publishDir, $secretsDir, $opsDir, $officialDir, $downloadsDir | Out-Null

$packageFile = Receive-Artifact $AnttPackageUrl $AnttPackagePath "antt-ciot-package" ".zip" $downloadsDir
$dllFile = Receive-Artifact $AnttDllUrl $AnttDllPath "antt-ciot-dll" ".dll" $downloadsDir
$exeFile = Receive-Artifact $AnttExeUrl $AnttExePath "antt-ciot-exe" ".exe" $downloadsDir
$dcsFile = Receive-Artifact $DcsUrl $DcsPath "antt-ciot-dcs" ".pdf" $downloadsDir

if ([string]::IsNullOrWhiteSpace($packageFile) -and
    [string]::IsNullOrWhiteSpace($dllFile) -and
    [string]::IsNullOrWhiteSpace($exeFile) -and
    [string]::IsNullOrWhiteSpace($AnttExecutablePath)) {
  throw "Informe -AnttPackageUrl, -AnttPackagePath, -AnttExeUrl, -AnttExePath, -AnttDllUrl ou -AnttDllPath com o pacote oficial da ANTT."
}

$packageInstallPath = Install-Artifact $packageFile $officialDir
$dllInstallPath = Install-Artifact $dllFile $officialDir
$exeInstallPath = Install-Artifact $exeFile $officialDir

if (!$AnttExecutablePath) {
  $candidate = Find-FirstExe $exeInstallPath
  if (!$candidate) { $candidate = Find-FirstExe $packageInstallPath }
  if (!$candidate) { $candidate = Find-FirstExe $officialDir }
  if (!$candidate) {
    throw "Nenhum executavel foi encontrado no pacote ANTT. Informe -AnttExecutablePath apontando para o EXE oficial ou para um adaptador EXE que use a DLL oficial conforme o DCS."
  }
  $AnttExecutablePath = $candidate.FullName
}

if (!(Test-Path $AnttExecutablePath)) {
  throw "Executavel ANTT não encontrado: $AnttExecutablePath"
}

$token = if ([string]::IsNullOrWhiteSpace($ConnectorToken)) { New-Token } else { $ConnectorToken }

Write-Host "Publicando microsserviço..."
dotnet publish $projectFile -c Release -r win-x64 --self-contained false -o $publishDir

$appsettings = @{
  Connector = @{
    Token = $token
    DryRun = $false
  }
  AnttProcess = @{
    ExecutablePath = $AnttExecutablePath
    WorkingDirectory = Split-Path $AnttExecutablePath -Parent
    ArgumentsTemplate = "--input `"{input}`" --output `"{output}`" --base-url `"{baseUrl}`" --environment `"{environment}`""
  }
  Kestrel = @{
    Endpoints = @{
      Http = @{
        Url = $ListenUrl
      }
    }
  }
  Logging = @{
    LogLevel = @{
      Default = "Information"
      "Microsoft.AspNetCore" = "Warning"
    }
  }
}

$settingsPath = Join-Path $publishDir "appsettings.$EnvironmentName.json"
$appsettings | ConvertTo-Json -Depth 8 | Set-Content -Path $settingsPath -Encoding UTF8
Protect-SecretFile $settingsPath

$publicCiotUrl = Join-UrlPath $PublicConnectorUrl "ciot"
if ([string]::IsNullOrWhiteSpace($publicCiotUrl)) {
  $publicCiotUrl = "https://<host-do-conector>/ciot"
}

if ([string]::IsNullOrWhiteSpace($ErpEnvFile)) {
  $ErpEnvFile = Join-Path $opsDir "erp-ciot-connector.env"
}

$erpEnvParent = Split-Path $ErpEnvFile -Parent
if (![string]::IsNullOrWhiteSpace($erpEnvParent)) {
  New-Item -ItemType Directory -Force -Path $erpEnvParent | Out-Null
}

$tokenPath = Join-Path $secretsDir "connector-token.txt"
Set-Content -Path $tokenPath -Value $token -Encoding UTF8
Protect-SecretFile $tokenPath

$erpEnvLines = @(
  "# Valores para configurar no ERP To Do Green",
  "TODOGREEN_ANTT_CIOT_CONNECTOR_URL=$publicCiotUrl",
  "TODOGREEN_ANTT_CIOT_CONNECTOR_TOKEN=$token",
  "TODOGREEN_ANTT_CIOT_A3_CONNECTOR_URL=$publicCiotUrl"
)
$erpEnvLines | Set-Content -Path $ErpEnvFile -Encoding UTF8
Protect-SecretFile $ErpEnvFile

$manifest = @{
  generatedAt = (Get-Date).ToString("o")
  serviceName = $ServiceName
  listenUrl = $ListenUrl
  publicConnectorUrl = $publicCiotUrl
  installRoot = $InstallRoot
  anttRoot = $AnttRoot
  anttExecutablePath = $AnttExecutablePath
  dcsFile = $dcsFile
  packageFile = $packageFile
  packageInstallPath = $packageInstallPath
  dllFile = $dllFile
  dllInstallPath = $dllInstallPath
  exeFile = $exeFile
  exeInstallPath = $exeInstallPath
  erpEnvFile = $ErpEnvFile
  tokenFile = $tokenPath
}
$manifestPath = Join-Path $opsDir "antt-ciot-install-manifest.json"
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

$exe = Join-Path $publishDir "ToDoGreen.AnttCiotConnector.exe"
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

New-Service `
  -Name $ServiceName `
  -BinaryPathName "`"$exe`" --environment $EnvironmentName" `
  -DisplayName "To Do Green ANTT CIOT Connector" `
  -StartupType Automatic

Start-Service -Name $ServiceName

Write-Host ""
Write-Host "Conector instalado."
Write-Host "Listen local: $ListenUrl"
Write-Host "Executavel ANTT: $AnttExecutablePath"
Write-Host "Token salvo em: $tokenPath"
Write-Host "Variáveis do ERP salvas em: $ErpEnvFile"
Write-Host "Manifest de instalação: $manifestPath"
if (!$SuppressTokenOutput) {
  Write-Host "Token do conector, configure no ERP:"
  Write-Host $token
}
Write-Host ""
Write-Host "No ERP, configure a URL HTTPS pública apontando para este serviço."
Write-Host "URL CIOT esperada no ERP: $publicCiotUrl"
