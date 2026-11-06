param(
    [Parameter(Mandatory=$true)][string]$TaskRoot,
    [Parameter(Mandatory=$true)][string[]]$Paths,
    [Parameter(Mandatory=$true)][string]$Receipt
)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$temporaryRoot = Join-Path $workspaceRoot '_tmp'
$taskBoundary = [IO.Path]::GetFullPath($TaskRoot).TrimEnd('\')
if (-not $taskBoundary.StartsWith($temporaryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Task root must be inside workspace _tmp' }
$receiptPath = [IO.Path]::GetFullPath($Receipt)
if (-not $receiptPath.StartsWith($workspaceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Receipt must stay inside workspace' }
Add-Type -AssemblyName Microsoft.VisualBasic
$records = @()
foreach ($entryPath in $Paths) {
    $targetPath = [IO.Path]::GetFullPath($entryPath).TrimEnd('\')
    if ($targetPath -ne $taskBoundary -and -not $targetPath.StartsWith($taskBoundary + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Target escapes task root' }
    # Check ancestors before enumerating children; never traverse a junction.
    $ancestor = $targetPath
    while ($ancestor.Length -ge $temporaryRoot.Length) {
        if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked ancestor: $ancestor" }
        if ($ancestor -eq $temporaryRoot) { break }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
    $queue = [Collections.Generic.Stack[string]]::new()
    $queue.Push($targetPath)
    $fileCount = 0
    [long]$byteCount = 0
    while ($queue.Count -gt 0) {
        $current = Get-Item -LiteralPath $queue.Pop() -Force
        if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link in cleanup: $($current.FullName)" }
        if ($current.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $current.FullName -Force) { $queue.Push($child.FullName) }
        } else { $fileCount++; $byteCount += $current.Length }
    }
    if ((Get-Item -LiteralPath $targetPath).PSIsContainer) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($targetPath, 'OnlyErrorDialogs', 'SendToRecycleBin', 'ThrowException')
    } else {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($targetPath, 'OnlyErrorDialogs', 'SendToRecycleBin', 'ThrowException')
    }
    if (Test-Path -LiteralPath $targetPath) { throw 'Recycled path still exists' }
    $records += [ordered]@{path=$targetPath; files=$fileCount; bytes=$byteCount; recycled=$true}
}
[ordered]@{action='SendToRecycleBin'; completed=$true; permanentDeletionUsed=$false; paths=$records} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
[ordered]@{recycledPaths=$records.Count; files=($records | ForEach-Object { $_.files } | Measure-Object -Sum).Sum; bytes=($records | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum; receipt=$receiptPath} | ConvertTo-Json -Compress
