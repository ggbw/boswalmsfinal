# run-qa.ps1 - Launch dev server and run the QA agent
# Usage:
#   .\qa\run-qa.ps1                                   # run all flows in qa-config.json
#   .\qa\run-qa.ps1 -FlowName "HR - Create test..."   # run only one flow by name

param(
    [string]$FlowName = ""
)

$ErrorActionPreference = "Stop"

# Ensure standard Windows tools (taskkill, etc.) resolve even when launched
# from a shell whose PATH doesn't include System32 (e.g. git-bash).
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:PATH"

# Always run from the project root, regardless of where the script is invoked
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# Make sure output directories exist
New-Item -ItemType Directory -Force -Path "qa\reports"     | Out-Null
New-Item -ItemType Directory -Force -Path "qa\screenshots" | Out-Null

# Read config (port + startup wait) from qa-config.json
$config       = Get-Content "qa\qa-config.json" -Raw | ConvertFrom-Json
$baseUrl      = $config.baseUrl
$startupWait  = if ($config.startupWaitSeconds) { [int]$config.startupWaitSeconds } else { 30 }

# Extract port from baseUrl (e.g. http://localhost:8080 -> 8080)
$port = ([uri]$baseUrl).Port
if (-not $port) { $port = 8080 }

Write-Host "[QA] Starting dev server (npm run dev) on port $port..."

# Start dev server in background. Use cmd /c so npm.cmd resolves cleanly,
# and capture the PID so we can tree-kill the whole process group on exit.
$dev = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c","npm","run","dev" `
    -PassThru -WindowStyle Hidden

# Poll the port until the dev server is accepting connections (or we time out)
$deadline = (Get-Date).AddSeconds($startupWait)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $conn = Test-NetConnection -ComputerName "localhost" -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
        if ($conn) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    Write-Host "[QA] Dev server did not become ready on port $port within $startupWait seconds." -ForegroundColor Red
    taskkill /PID $dev.Id /T /F | Out-Null
    exit 1
}

Write-Host "[QA] Dev server is up at $baseUrl. Launching Claude QA agent..."

try {
    $prompt = Get-Content "qa\qa-prompt.md" -Raw

    # If -FlowName was passed, prepend an instruction so the agent runs only that flow.
    if ($FlowName) {
        $filter = @"
IMPORTANT FLOW FILTER: For THIS run, execute ONLY the flow named '$FlowName' from qa/qa-config.json. Skip every other flow in the config (do not list them under 'Skipped' - they are simply not requested this run). Still follow all skipAreas and the rest of the instructions below.

"@
        $prompt = $filter + $prompt
        Write-Host "[QA] Filter active: running only flow '$FlowName'"
    }

    # Run Claude in headless mode with the QA prompt.
    # --allowedTools whitelist: Playwright MCP for browser control + local file I/O.
    claude -p $prompt `
        --allowedTools "mcp__playwright,Read,Write,Bash,Glob,Grep" `
        --output-format text
}
finally {
    Write-Host "[QA] Shutting down dev server (pid $($dev.Id))..."
    # /T = tree-kill (kills npm.cmd AND the vite child process). /F = force.
    taskkill /PID $dev.Id /T /F 2>$null | Out-Null
}

Write-Host "[QA] Done. Check qa\reports\ for the latest report."
