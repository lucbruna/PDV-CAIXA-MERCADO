# Gera um certificado autoassinado para o Sudam Gestao PDV no Windows.
#
# Por que isto existe: sem HTTPS, a senha do caixa e o token de sessao cruzam a
# rede local em texto puro. No Linux o instalar-linux.sh monta nginx + HTTPS;
# no Windows o servidor tambem aceita TLS, so precisa do certificado. Este
# script cria o certificado usando so o que o Windows ja tem (New-SelfSigned
# Certificate + Export-PfxCertificate) e exporta um .pfx que o Node le.
#
# Nao precisa de administrador: usa o cofre do usuario atual (CurrentUser).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File GERAR-CERTIFICADO.ps1
#
# Depois, para subir o PDV com HTTPS, defina as variaveis antes de iniciar:
#   set SUDAM_TLS=1
#   set SUDAM_PFX=<caminho do .pfx>
#   set SUDAM_PFX_SENHA=<senha usada aqui>

param(
  [string]$Nome = "sudam-pdv",
  [string]$Senha = "",
  [string]$Saida = (Join-Path $PSScriptRoot "servidor\certificado.pfx")
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Senha)) {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32
  $rng.GetBytes($bytes)
  $Senha = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $rng.Dispose()
}

Write-Host ""
Write-Host "Gerando certificado autoassinado..." -ForegroundColor Cyan

# Nomes que o certificado cobre: localhost e os IPs de rede desta maquina, para
# os caixas poderem abrir https://<ip>:8787 sem o nome nao bater.
$nomes = @("localhost")
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
         Where-Object { $_.IPAddress -notlike "127.*" } |
         Select-Object -ExpandProperty IPAddress
  if ($ips) { $nomes += $ips }
} catch {
  Write-Host "  (nao consegui listar os IPs; sigo com localhost)" -ForegroundColor Yellow
}

$cert = New-SelfSignedCertificate `
  -Subject "CN=$Nome" `
  -DnsName $nomes `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(10) `
  -KeyAlgorithm RSA `
  -KeyLength 2048

$seguro = ConvertTo-SecureString -String $Senha -Force -AsPlainText
$pasta = Split-Path -Parent $Saida
if ($pasta -and -not (Test-Path $pasta)) { New-Item -ItemType Directory -Path $pasta | Out-Null }

Export-PfxCertificate -Cert $cert -FilePath $Saida -Password $seguro | Out-Null

Write-Host ""
Write-Host "Certificado criado em: $Saida" -ForegroundColor Green
Write-Host "Senha do arquivo:      $Senha" -ForegroundColor Green
Write-Host "Validade:              10 anos"
Write-Host ""
Write-Host "Para ligar o HTTPS, defina estas variaveis antes de iniciar o PDV:"
Write-Host "  set SUDAM_TLS=1"
Write-Host "  set SUDAM_PFX=$Saida"
Write-Host "  set SUDAM_PFX_SENHA=$Senha"
Write-Host ""
Write-Host "Depois acesse https://localhost:8787 (o aviso de certificado e esperado:" -ForegroundColor Yellow
Write-Host "e autoassinado, como no modo Linux com nginx)." -ForegroundColor Yellow
