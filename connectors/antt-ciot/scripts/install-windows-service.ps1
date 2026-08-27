param(
  [Parameter(Mandatory=$true)]
  [string]$PublishDir,

  [string]$ServiceName = "ToDoGreenAnttCiotConnector",
  [string]$DisplayName = "To Do Green ANTT CIOT Connector"
)

$exe = Join-Path $PublishDir "ToDoGreen.AnttCiotConnector.exe"
if (!(Test-Path $exe)) {
  throw "Executavel não encontrado: $exe. Rode: dotnet publish -c Release -r win-x64 --self-contained false"
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $ServiceName -ErrorAction SilentlyContinue
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

New-Service `
  -Name $ServiceName `
  -BinaryPathName "`"$exe`" --environment Production" `
  -DisplayName $DisplayName `
  -StartupType Automatic

Start-Service -Name $ServiceName
Get-Service -Name $ServiceName
