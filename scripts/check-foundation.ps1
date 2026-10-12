# Requires PowerShell 7. Uses no application runtime, network or secrets.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    $failures = [System.Collections.Generic.List[string]]::new()
    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    $files = @(git -c core.quotepath=false ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate repository files.' }
    $documents = @{}
    $count = 0
    foreach ($path in ($files | Sort-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        if ($path -notmatch '\.(md|ya?ml|toml|ps1)$|(^|/)(\.editorconfig|\.gitignore|\.env\.example)$') { continue }
        # Never read local environment files, tokens or CLI authentication files.
        if ($path -match '(^|/)(\.env(\.|$)|\.doppler)' -and $path -notmatch '(^|/)\.env\.example$') { continue }
        try { $content = [System.IO.File]::ReadAllText((Join-Path $root $path), $utf8) }
        catch { $failures.Add("${path}: invalid UTF-8 or unreadable file"); continue }
        $count++
        if ($content -match '(?m)^(<{7} |={7}$|>{7} )') { $failures.Add("${path}: merge conflict marker") }
        if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $failures.Add("${path}: missing final newline") }
        if ($path -match '\.md$') { $documents[$path] = $content }
        if ($path -match '(^|/)\.env\.example$') {
            foreach ($line in ($content -split "`n")) {
                if ($line.Trim() -and $line -notmatch '^\s*#' -and $line -notmatch '^\s*[A-Za-z_][A-Za-z0-9_]*=\s*$') {
                    $failures.Add("${path}: examples must contain comments or empty KEY= entries only")
                }
            }
        }
    }

    $linkCount = 0
    foreach ($path in $documents.Keys) {
        # Inline Markdown links; fenced examples are not live documentation links.
        $content = [regex]::Replace($documents[$path], '(?ms)^```[^\n]*\n.*?^```\s*$', '')
        foreach ($match in [regex]::Matches($content, '\[[^\]\r\n]*\]\(([^\s)]+)\)')) {
            $target = $match.Groups[1].Value.Trim('<', '>')
            if ($target -match '^[a-zA-Z][a-zA-Z0-9+.-]*:|^//') { continue }
            $parts = $target -split '#', 2
            $relative = [uri]::UnescapeDataString($parts[0])
            $full = if ($relative) { [System.IO.Path]::GetFullPath((Join-Path (Split-Path (Join-Path $root $path)) $relative)) } else { Join-Path $root $path }
            $linkCount++
            if (-not (Test-Path -LiteralPath $full)) { $failures.Add("${path}: missing link target $target"); continue }
            if ($parts.Count -eq 2 -and $full.EndsWith('.md') -and $parts[1]) {
                $anchors = [System.Collections.Generic.List[string]]::new()
                $seen = @{}
                $body = [System.IO.File]::ReadAllText($full, $utf8)
                $body = [regex]::Replace($body, '(?ms)^```[^\n]*\n.*?^```\s*$', '')
                foreach ($heading in [regex]::Matches($body, '(?m)^#{1,6}\s+(.+?)\s*\r?$')) {
                    $slug = $heading.Groups[1].Value.ToLowerInvariant() -replace '[^\p{L}\p{N}_\-\s]', '' -replace '\s', '-'
                    if ($seen.ContainsKey($slug)) { $seen[$slug]++; $anchors.Add("$slug-$($seen[$slug])") }
                    else { $seen[$slug] = 0; $anchors.Add($slug) }
                }
                if (-not $anchors.Contains([uri]::UnescapeDataString($parts[1]))) { $failures.Add("${path}: missing heading $target") }
            }
        }
    }

    foreach ($path in @('.env', '.env.local', 'nested/.env.production', '.doppler.yaml', '.secrets.json', '.tools/probe')) {
        git check-ignore --no-index -q -- $path
        if ($LASTEXITCODE -ne 0) { $failures.Add("${path}: expected to be ignored") }
    }
    git check-ignore --no-index -q -- .env.example
    if ($LASTEXITCODE -ne 1) { $failures.Add('.env.example: must be trackable') }
    git diff --check
    if ($LASTEXITCODE -ne 0) { $failures.Add('Working-tree whitespace check failed.') }
    git diff --cached --check
    if ($LASTEXITCODE -ne 0) { $failures.Add('Staged whitespace check failed.') }
    if ($failures.Count) {
        $failures | ForEach-Object { Write-Host "ERROR: $_" }
        throw "$($failures.Count) foundation check(s) failed."
    }
    Write-Host "PASS: $count text files; $linkCount local links; environment examples; 7 ignore cases; working and staged diff whitespace."
    Write-Host 'This foundation check does not run application build, typecheck, lint, or tests.'
} finally {
    Pop-Location
}
