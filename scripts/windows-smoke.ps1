# Release check on a real Windows machine (GitHub's Windows runner): the installer runs silently
# (as the self-updater runs it), the installed app starts on the game shelf and its table server answers.
$ErrorActionPreference = "Stop"
$version = (Get-Content package.json | ConvertFrom-Json).version
$setup = Resolve-Path "release/Monolith-Setup-$version.exe"
Write-Host "== installing $setup silently"
$p = Start-Process -FilePath $setup -ArgumentList "/S" -PassThru -Wait
if ($p.ExitCode -ne 0) { throw "installer exited with $($p.ExitCode)" }
Start-Sleep -Seconds 4
Get-Process Monolith -ErrorAction SilentlyContinue | Stop-Process -Force   # the installer reopens the app after a silent install
Start-Sleep -Seconds 2
$exe = Join-Path $env:LOCALAPPDATA "Programs\Monolith\Monolith.exe"
if (-not (Test-Path $exe)) { throw "Monolith.exe wasn't installed at $exe" }
$out = Join-Path $env:RUNNER_TEMP "win-smoke.json"
Write-Host "== starting $exe"
Start-Process -FilePath $exe -ArgumentList "--monolith-smoke-out=$out"
for ($i = 0; $i -lt 120; $i++) { if ((Test-Path $out) -and ((Get-Content $out -Raw) -match '"finished": true')) { break }; Start-Sleep -Seconds 1 }
$json = Get-Content $out -Raw
Write-Host $json
if ($json -notmatch '"ok": true') { Write-Host "::error title=Windows check::$($json -replace "`r?`n",' ')"; throw "smoke run failed" }
if ($json -notmatch '"page": "launcher.html"') { throw "didn't open on the game shelf" }
if ($json -notmatch '"serverStatus": 200') { throw "table server didn't answer" }
Write-Host "::notice title=Windows check::installed silently, started on the game shelf, table server answered"
Write-Host "SMOKE OK"
