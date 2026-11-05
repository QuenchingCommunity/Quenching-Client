param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$base=[IO.Path]::GetFullPath($Root)
$rows=@(Get-ChildItem -LiteralPath $base -File -Recurse | Where-Object { $_.Extension -in @('.exe','.dll','.node') } | ForEach-Object {
  $signature=Get-AuthenticodeSignature -LiteralPath $_.FullName
  [pscustomobject]@{path=$_.FullName.Substring($base.Length).TrimStart('\');status=[string]$signature.Status;timestamp=($null -ne $signature.TimeStamperCertificate)}
})
ConvertTo-Json -InputObject $rows -Compress -Depth 4
