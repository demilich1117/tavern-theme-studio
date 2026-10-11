$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = '首次使用：选择 SillyTavern 酒馆文件夹（包含 server.js）。只需选择一次。'
$picker.ShowNewFolderButton = $false
try {
    if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        [Console]::Write($picker.SelectedPath)
    }
} finally { $picker.Dispose() }
