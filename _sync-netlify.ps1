$ErrorActionPreference = 'Stop'
$root = 'c:\Users\Administrador\Downloads\sameka'
$srcPath = Join-Path $root 'front-sameka.html'
$netDir = Join-Path $root 'netlify'

$html = [System.IO.File]::ReadAllText($srcPath, [System.Text.UTF8Encoding]::new($false))

# Find the 3 inline <script> blocks (without src) in order
$pattern = '(?s)<script>\s*(.*?)\s*</script>'
$rx = [System.Text.RegularExpressions.Regex]::new($pattern)
$matches = $rx.Matches($html)
if ($matches.Count -lt 3) { throw "Expected at least 3 inline script blocks, found $($matches.Count)" }

$polyfills  = $matches[0].Groups[1].Value
$authStore  = $matches[1].Groups[1].Value
$appJs      = $matches[2].Groups[1].Value

# Write external JS files
[System.IO.File]::WriteAllText((Join-Path $netDir 'polyfills.js'),    $polyfills + "`r`n", [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $netDir 'auth-storage.js'), $authStore + "`r`n", [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $netDir 'app.js'),          $appJs     + "`r`n", [System.Text.UTF8Encoding]::new($false))

# Build index.html: replace inline scripts with external refs, add netlify-no-optimize marker
$indexHtml = $html

# Replace third (app) inline script first (deepest in document) to keep indices stable
$indexHtml = [System.Text.RegularExpressions.Regex]::Replace(
  $indexHtml,
  '(?s)<script>\s*lucide\.createIcons\(\);.*?</script>',
  '<script src="app.js"></script>',
  1)

# Replace second (auth-storage) inline script
$indexHtml = [System.Text.RegularExpressions.Regex]::Replace(
  $indexHtml,
  '(?s)<script>\s*function buildAuthStorage\(\).*?</script>',
  '<script src="auth-storage.js"></script>',
  1)

# Replace first (polyfills IIFE) inline script
$indexHtml = [System.Text.RegularExpressions.Regex]::Replace(
  $indexHtml,
  '(?s)<script>\s*\(function \(\) \{\s*function c\(\).*?</script>',
  '<script src="polyfills.js"></script>',
  1)

# Add netlify-no-optimize marker after <head>
if ($indexHtml -notmatch 'netlify-no-optimize') {
  $indexHtml = $indexHtml -replace '<head>', "<head>`r`n    <!--netlify-no-optimize-->"
}

[System.IO.File]::WriteAllText((Join-Path $netDir 'index.html'), $indexHtml, [System.Text.UTF8Encoding]::new($false))

Write-Host ("OK. polyfills.js=" + $polyfills.Length + " auth-storage.js=" + $authStore.Length + " app.js=" + $appJs.Length + " index.html=" + $indexHtml.Length)
