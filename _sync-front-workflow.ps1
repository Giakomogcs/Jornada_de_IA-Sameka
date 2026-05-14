$ErrorActionPreference = 'Stop'
$root = 'c:\Users\Administrador\Downloads\sameka'
$htmlPath = Join-Path $root 'front-sameka.html'
$wfPath = Join-Path $root 'workspaces\Sameka-Front.json'
$html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.UTF8Encoding]::new($false))
$wf = Get-Content -Path $wfPath -Raw -Encoding UTF8 | ConvertFrom-Json
$node = $wf.nodes | Where-Object { $_.name -eq 'HTML' }
if (-not $node) { throw 'HTML node not found' }
$node.parameters.html = $html
$json = $wf | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($wfPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host ("Updated workflow. HTML length: " + $html.Length)
