param(
  [string]$HealthUrl = "http://127.0.0.1:8088/health",
  [string]$ConnectorUrl = "",
  [string]$Token = "",
  [string]$BaseUrl = "https://appservices-hml.antt.gov.br/ciot"
)

$ErrorActionPreference = "Stop"

function Get-StatusCodeFromError($ErrorRecord) {
  $response = $ErrorRecord.Exception.Response
  if (!$response) {
    return 0
  }

  return [int]$response.StatusCode
}

Write-Host "Testando health do conector..."
$health = Invoke-RestMethod -Method Get -Uri $HealthUrl
Write-Host "Health OK: $($health.status)"

if ([string]::IsNullOrWhiteSpace($ConnectorUrl) -or [string]::IsNullOrWhiteSpace($Token)) {
  Write-Host "Token não testado. Informe -ConnectorUrl e -Token para validar a autorizacao do POST /ciot."
  exit 0
}

$probe = @{
  mode = "token_probe"
  requiresIpef = $false
  environment = "homologation"
  baseUrl = $BaseUrl
  certificate = @{
    standard = "ICP-Brasil"
    type = "A1"
  }
  ciot = @{}
} | ConvertTo-Json -Depth 8

Write-Host "Testando token do conector sem emitir CIOT..."
try {
  Invoke-WebRequest `
    -Method Post `
    -Uri $ConnectorUrl `
    -Headers @{ Authorization = "Bearer $Token" } `
    -ContentType "application/json" `
    -Body $probe `
    -ErrorAction Stop | Out-Null

  throw "Resposta inesperada: o probe deveria ser recusado por modo inválido."
} catch {
  $statusCode = Get-StatusCodeFromError $_
  if ($statusCode -eq 400) {
    Write-Host "Token OK: o conector autenticou a chamada e recusou apenas o modo de teste."
    exit 0
  }

  if ($statusCode -eq 401) {
    throw "Token recusado pelo conector."
  }

  throw
}
