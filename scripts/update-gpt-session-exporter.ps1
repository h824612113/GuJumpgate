param(
  [string]$RepoUrl = "https://github.com/gtxx3600/GPTSession2CPAandSub2API.git"
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ProjectDir = Join-Path $RootDir "services\GPTSession2CPAandSub2API"
$CompatPath = Join-Path $RootDir "scripts\gpt-session-export-configs.mjs"

function Run-Git {
  param([string[]]$ArgsList)
  & git @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "git $($ArgsList -join ' ') failed with exit code $LASTEXITCODE"
  }
}

if (!(Test-Path -LiteralPath $ProjectDir)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ProjectDir) | Out-Null
  Run-Git @("clone", $RepoUrl, $ProjectDir)
}

if (!(Test-Path -LiteralPath (Join-Path $ProjectDir ".git"))) {
  throw "GPTSession2CPAandSub2API directory exists but is not a git repository: $ProjectDir"
}

$dirtyTracked = (& git -C $ProjectDir status --porcelain --untracked-files=no)
if ($dirtyTracked) {
  throw "GPTSession2CPAandSub2API has tracked local changes; resolve them before updating.`n$dirtyTracked"
}

Run-Git @("-C", $ProjectDir, "fetch", "origin")
Run-Git @("-C", $ProjectDir, "pull", "--ff-only", "origin", "main")

if (!(Test-Path -LiteralPath $CompatPath)) {
  throw "Missing project compatibility CLI: $CompatPath"
}

& node --check $CompatPath
if ($LASTEXITCODE -ne 0) {
  throw "Compatibility CLI syntax check failed: $CompatPath"
}

$TestPath = Join-Path $ProjectDir "tests\convert-session.test.js"
if (Test-Path -LiteralPath $TestPath) {
  & node $TestPath
  if ($LASTEXITCODE -ne 0) {
    throw "GPTSession2CPAandSub2API converter tests failed."
  }
}

Write-Host "GPTSession2CPAandSub2API updated and verified: $ProjectDir"
