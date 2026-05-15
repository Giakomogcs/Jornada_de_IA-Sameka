
#!/usr/bin/env pwsh
<#
.SYNOPSIS
  PreToolUse hook: block dangerous patterns from being written into workflows/migrations/front.

.DESCRIPTION
  Reads the JSON payload from stdin (VS Code Copilot hook contract) and inspects the
  proposed file change. Blocks when the new content contains forbidden tokens for the file class.

  Forbidden:
    - DROP TABLE / DROP SCHEMA ... CASCADE in workspaces/*.json (n8n)
    - files.delete in workspaces/*.json (Google Drive)
    - ON DELETE CASCADE referencing auth.users in migrations/*.sql
    - SUPABASE_SERVICE_ROLE_KEY hardcoded in front-*.html or netlify/*

  Exit codes:
    0 = allow
    2 = block (Copilot/Claude treats non-zero as block + reason on stderr)
#>

$ErrorActionPreference = 'Stop'

# Read hook payload from stdin
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }

try { $payload = $raw | ConvertFrom-Json } catch { exit 0 }

function Get-FirstNonEmpty {
    foreach ($v in $args) {
        if ($null -ne $v -and "$v" -ne '') { return $v }
    }
    return $null
}

function Get-Prop($obj, [string]$name) {
    if ($null -eq $obj) { return $null }
    if ($obj.PSObject.Properties.Match($name).Count -gt 0) { return $obj.$name }
    return $null
}

$ti     = Get-Prop $payload 'tool_input'
$params = Get-Prop $payload 'params'

$filePath = Get-FirstNonEmpty `
    (Get-Prop $ti     'filePath')  `
    (Get-Prop $ti     'file_path') `
    (Get-Prop $ti     'path')      `
    (Get-Prop $params 'filePath')  `
    (Get-Prop $payload 'filePath')

$newContent = Get-FirstNonEmpty `
    (Get-Prop $ti     'content')   `
    (Get-Prop $ti     'newString') `
    (Get-Prop $ti     'new_str')   `
    (Get-Prop $params 'content')   `
    (Get-Prop $payload 'content')

if (-not $filePath)   { exit 0 }
if (-not $newContent) { exit 0 }

$normalized = $filePath -replace '\\','/'
$violations = @()

function Add-Violation([string]$rule, [string]$detail) {
    $script:violations += "[$rule] $detail"
}

# 1) n8n workflows must not contain DROP CASCADE or files.delete
if ($normalized -match '/workspaces/.+\.json$') {
    if ($newContent -match '(?i)DROP\s+(TABLE|SCHEMA)[^;]*CASCADE') {
        Add-Violation 'NO_DROP_CASCADE' 'DROP ... CASCADE encontrado em workflow do n8n. Use TRUNCATE ... RESTART IDENTITY.'
    }
    if ($newContent -match '(?i)files\s*\.\s*delete\s*\(') {
        Add-Violation 'NO_DRIVE_DELETE' 'files.delete encontrado. Use o subflow Drive Content Replace (files.update no mesmo file_id).'
    }
}

# 2) SQL migrations must not CASCADE to auth.users
if ($normalized -match '/migrations/.+\.sql$') {
    if ($newContent -match '(?is)REFERENCES\s+auth\.users[^,;)]*ON\s+DELETE\s+CASCADE') {
        Add-Violation 'NO_AUTH_USERS_CASCADE' 'ON DELETE CASCADE em FK para auth.users. Use ON DELETE SET NULL.'
    }
    if ($newContent -match '(?i)DROP\s+(TABLE|SCHEMA)[^;]*CASCADE') {
        Add-Violation 'NO_DROP_CASCADE' 'DROP ... CASCADE em migration. Migrations devem ser idempotentes e aditivas.'
    }
}

# 3) Service-role / secrets must not appear in front-end bundle
if ($normalized -match '/(front-[^/]+\.html|netlify/[^/]+\.(html|js|css))$') {
    if ($newContent -match 'SUPABASE_SERVICE_ROLE_KEY') {
        Add-Violation 'NO_SERVICE_ROLE_IN_FRONT' 'SUPABASE_SERVICE_ROLE_KEY no front. Mova para credentials do n8n.'
    }
    # JWT-shaped tokens longer than the typical anon key length (>500 chars) are suspicious in the front.
    $m = [regex]::Matches($newContent, 'eyJ[A-Za-z0-9_\-]{50,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}')
    foreach ($match in $m) {
        if ($match.Value.Length -gt 500) {
            Add-Violation 'POSSIBLE_SECRET_JWT' "JWT muito longo ($($match.Value.Length) chars) — provável service-role/Postgres password no bundle do front."
            break
        }
    }
}

if ($violations.Count -gt 0) {
    [Console]::Error.WriteLine("BLOCKED by check-dangerous-patterns.ps1:")
    foreach ($v in $violations) {
        [Console]::Error.WriteLine("  - $v")
    }
    exit 2
}

exit 0
