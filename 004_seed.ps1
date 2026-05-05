# =============================================
# Sameka — Seed Admin User
# Creates admin via GoTrue API (not raw SQL!)
# =============================================

$SUPABASE_URL = "https://longflatworm-supabase.cloudfy.live"
$ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzczNjY1NzE2LCJleHAiOjE4MDUyMDE3MTZ9.nM55mAkSiyvvaIoUACEw4pY4GSJVfvrMX7b1q5JVwyg"

$EMAIL    = "admin@sameka.com.br"
$PASSWORD = "@Admin123"

Write-Host "`n=== Step 1: Create admin user via GoTrue signup ===" -ForegroundColor Cyan

$body = @{
    email    = $EMAIL
    password = $PASSWORD
    data     = @{
        full_name    = "Administrador"
        role         = "admin"
        company_name = "sameka"
    }
} | ConvertTo-Json -Depth 3

try {
    $response = Invoke-RestMethod `
        -Uri "$SUPABASE_URL/auth/v1/signup" `
        -Method POST `
        -ContentType "application/json" `
        -Headers @{ apikey = $ANON_KEY } `
        -Body $body

    Write-Host "User created successfully!" -ForegroundColor Green
    Write-Host "User ID: $($response.id)"
    Write-Host "Email:   $($response.email)"

    if ($response.id) {
        Write-Host "`n=== Step 2: Confirm email + set admin metadata ===" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Now run this SQL in your Supabase DB (via psql, pgAdmin, or Supabase Studio):" -ForegroundColor Yellow
        Write-Host ""
        Write-Host @"
-- Confirm the admin's email (skip email verification)
UPDATE auth.users
SET email_confirmed_at = now(),
    raw_user_meta_data = raw_user_meta_data || '{"role": "admin", "company_name": "sameka"}'::jsonb
WHERE email = '$EMAIL';
"@ -ForegroundColor White
        Write-Host ""
        Write-Host "After running the SQL, the admin can log in immediately." -ForegroundColor Green
    }
}
catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errorBody = $_.ErrorDetails.Message

    if ($errorBody -match "already registered" -or $statusCode -eq 422) {
        Write-Host "User already exists. Attempting to clean up and retry..." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Run this SQL first to delete the broken user, then re-run this script:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host @"
-- Delete the existing broken admin user
DELETE FROM auth.users WHERE email = '$EMAIL';
"@ -ForegroundColor White
        Write-Host ""
    }
    else {
        Write-Host "Error ($statusCode): $errorBody" -ForegroundColor Red
    }
}