<#
.SYNOPSIS
  Set every GitHub Actions secret the backup workflows need, without touching
  the web form.

.DESCRIPTION
  The "New repository secret" page has two boxes -- a one-line Name and a large
  Secret -- and putting the wrong thing in the Name box produces:

      Secret names can only contain alphanumeric characters ... Spaces are not
      allowed.

  That is easy to hit with RCLONE_CONFIG, whose value is an eight-line file.
  This script sets the names itself, so there is no box to get wrong, and reads
  the rclone config straight off disk so the value is never retyped, reflowed,
  or truncated by a clipboard.

  Values come from what is already on this machine:
    RCLONE_CONFIG         %APPDATA%\rclone\rclone.conf, byte for byte
    BACKUP_REPORT_SECRET  .env.local (the value the deployed function accepts)
    RCLONE_REMOTE         the Drive folder that actually exists
    SUPABASE_URL          this project
    PGURI                 asked for, because it holds the database password and
                          belongs in neither a file here nor a shell history

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\set-github-secrets.ps1
#>

$ErrorActionPreference = 'Stop'
$REPO = 'ggbw/boswalmsfinal'

function Say($m)  { Write-Host $m }
function Ok($m)   { Write-Host "  OK    $m"   -ForegroundColor Green }
function Warn($m) { Write-Host "  SKIP  $m"   -ForegroundColor Yellow }
function Bad($m)  { Write-Host "  FAIL  $m"   -ForegroundColor Red }

# ── Find gh ───────────────────────────────────────────────────────────────────
# A freshly installed gh is not on the PATH of a shell that was already open,
# which looks exactly like "not installed".
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) {
  $candidate = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
  if (Test-Path $candidate) { $gh = $candidate }
}
if (-not $gh) {
  Bad 'The GitHub CLI is not installed. Run:  winget install --id GitHub.cli'
  exit 1
}
Say "GitHub CLI: $gh"

# ── Sign in ───────────────────────────────────────────────────────────────────
& $gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Say ''
  Say 'Not signed in. A browser window will open -- copy the code shown here'
  Say 'into it. Nothing is typed into this terminal.'
  Say ''
  & $gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { Bad 'Sign-in failed.'; exit 1 }
}

# gh needs the admin:repo_hook/repo scope to write secrets; refresh if not held.
$scopes = (& $gh auth status 2>&1 | Out-String)
if ($scopes -notmatch 'repo') {
  Say 'Adding the repo scope so secrets can be written...'
  & $gh auth refresh -h github.com -s repo
}

# ── Gather the values ─────────────────────────────────────────────────────────
$secrets = [ordered]@{}

$conf = Join-Path $env:APPDATA 'rclone\rclone.conf'
if (Test-Path $conf) {
  $text = Get-Content -Raw -LiteralPath $conf
  if ($text -match '\[gdrive\]') { $secrets['RCLONE_CONFIG'] = $text }
  else { Bad "$conf has no [gdrive] section -- run 'rclone config' first." }
} else {
  Bad "No rclone config at $conf -- run 'rclone config' first."
}

$secrets['RCLONE_REMOTE'] = 'gdrive:Supabase-Backups'
$secrets['SUPABASE_URL']  = 'https://gmdbrgjxdeztgzvqsaaj.supabase.co'

$envLocal = Join-Path $PSScriptRoot '..\.env.local'
if (Test-Path $envLocal) {
  $line = Select-String -Path $envLocal -Pattern '^BACKUP_REPORT_SECRET=' | Select-Object -First 1
  if ($line) { $secrets['BACKUP_REPORT_SECRET'] = ($line.Line -replace '^[^=]*=', '').Trim('"').Trim() }
}
if (-not $secrets['BACKUP_REPORT_SECRET']) {
  Warn 'BACKUP_REPORT_SECRET not found in .env.local -- set it by hand afterwards.'
}

Say ''
Say 'PGURI is the database connection string, and it contains the password.'
Say 'Supabase -> Connect -> Session pooler. Leave blank to skip for now.'
$pg = Read-Host 'PGURI'
if ($pg) { $secrets['PGURI'] = $pg }

Say ''
Say 'GPG_PASSPHRASE encrypts every dump. Recommended -- but if it is lost, every'
Say 'backup is unopenable. Save it in your password manager BEFORE typing it.'
Say 'Leave blank to upload unencrypted.'
$gpg = Read-Host 'GPG_PASSPHRASE'
if ($gpg) { $secrets['GPG_PASSPHRASE'] = $gpg }

# ── Set them ──────────────────────────────────────────────────────────────────
Say ''
Say "Setting secrets on $REPO"
$failed = 0
foreach ($name in $secrets.Keys) {
  $value = $secrets[$name]
  if (-not $value) { Warn "$name (no value)"; continue }
  # Piped on stdin, never as an argument: a value with quotes, braces or
  # newlines survives intact and never appears in the process list.
  $value | & $gh secret set $name --repo $REPO 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok "$name ($($value.Length) chars)" }
  else { Bad "$name"; $failed++ }
}

Say ''
Say 'Secrets now on the repository:'
& $gh secret list --repo $REPO

if ($failed -eq 0) {
  Say ''
  Say 'Start a backup now with:'
  Say "  gh workflow run db-backup.yml --repo $REPO"
  Say 'then watch it at https://github.com/ggbw/boswalmsfinal/actions'
} else {
  Bad "$failed secret(s) could not be set."
  exit 1
}
