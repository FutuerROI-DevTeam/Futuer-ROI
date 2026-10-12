# Exercise the actual checker on disposable copies, never source diagrams.
[CmdletBinding()]
param([string]$CheckerPath = (Join-Path $PSScriptRoot '../check-document-diagrams.ps1'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('diagram-arrow-' + [guid]::NewGuid().ToString('N'))
$diagrams = Join-Path $fixture 'docs/diagrams'
$scripts = Join-Path $fixture 'scripts'
New-Item -ItemType Directory -Path $diagrams,$scripts -Force | Out-Null
$checker = Join-Path $scripts 'check-document-diagrams.ps1'
Copy-Item -LiteralPath $CheckerPath -Destination $checker
$originalHashes = @{}
foreach ($name in @('system-architecture','user-flow')) {
    foreach ($ext in @('svg','drawio')) {
        $p=Join-Path $repo "docs/diagrams/$name.$ext"
        $originalHashes[$p]=(Get-FileHash -LiteralPath $p).Hash
    }
}
function Reset-Fixture {
    foreach ($p in $originalHashes.Keys) {
        Copy-Item -LiteralPath $p -Destination $diagrams -Force
    }
}
function Set-Arrow($cell, [string]$side, [string]$kind) {
    $style=$cell.GetAttribute('style') -replace "(?:^|;)${side}Arrow=[^;]*;?", ';'
    if ($kind -ne 'missing') { $style+="${side}Arrow=$kind;" }
    $cell.SetAttribute('style',$style)
}
$cases = [Collections.Generic.List[object]]::new()
$cases.Add(@{name='approved originals';pass=$true;side='';mode='unchanged'})
foreach ($side in @('start','end')) {
    foreach ($kind in @('none','missing','classic','oval','diamond')) {
        $cases.Add(@{name="$side source $kind with stale SVG";pass=$false;side=$side;mode='source';kind=$kind})
    }
    foreach ($mode in @('remove','none','empty','unknown-reference','wrong-shape','missing-definition','duplicate-definition','wrong-orientation','unfilled-marker')) {
        $cases.Add(@{name="$side SVG $mode with block source";pass=$false;side=$side;mode=$mode})
    }
    $cases.Add(@{name="$side matching none (attribute absent)";pass=$true;side=$side;mode='matching-none'})
    $cases.Add(@{name="$side matching none (explicit none)";pass=$true;side=$side;mode='matching-none-attribute'})
}
$cases.Add(@{name='both endpoints matching none';pass=$true;side='both';mode='both-none'})
$failures = [Collections.Generic.List[string]]::new()
foreach ($case in $cases) {
    Reset-Fixture
    if ($case.mode -ne 'unchanged') {
        $name = if ($case.side -eq 'start') { 'system-architecture' } else { 'user-flow' }
        $sourcePath=Join-Path $diagrams "$name.drawio"
        $svgPath=Join-Path $diagrams "$name.svg"
        $source=[xml][IO.File]::ReadAllText($sourcePath)
        $svg=[xml][IO.File]::ReadAllText($svgPath)
        $cell=$source.SelectNodes('//mxCell[@edge="1"]')[0]
        $edge=$svg.SelectNodes('/*[local-name()="svg"]/*[local-name()="path" and @fill="none"]')[0]
        $marker=$svg.SelectSingleNode('/*[local-name()="svg"]/*[local-name()="defs"]/*[local-name()="marker"]')
        $attribute="marker-$($case.side)"
        switch ($case.mode) {
            'source' { Set-Arrow $cell $case.side $case.kind }
            'remove' { $edge.RemoveAttribute($attribute) }
            'none' { $edge.SetAttribute($attribute,'none') }
            'empty' { $edge.SetAttribute($attribute,'') }
            'unknown-reference' { $edge.SetAttribute($attribute,'url(#missing)') }
            'wrong-shape' { $marker.FirstChild.SetAttribute('d','M1 1L9 1L9 9L1 9Z') }
            'missing-definition' { $null=$marker.ParentNode.RemoveChild($marker) }
            'duplicate-definition' { $null=$marker.ParentNode.AppendChild($marker.CloneNode($true)) }
            'wrong-orientation' { $marker.SetAttribute('orient','0') }
            'unfilled-marker' { $marker.FirstChild.SetAttribute('fill','none') }
            'matching-none' {
                Set-Arrow $cell $case.side 'none'
                $edge.RemoveAttribute($attribute)
            }
            'matching-none-attribute' {
                Set-Arrow $cell $case.side 'none'
                $edge.SetAttribute($attribute,'none')
            }
            'both-none' {
                foreach($side in @('start','end')) {
                    Set-Arrow $cell $side 'none'
                    $edge.RemoveAttribute("marker-$side")
                }
            }
        }
        $source.Save($sourcePath)
        $svg.Save($svgPath)
    }
    $passed=$true
    $reason=''
    try {
        & $checker | Out-Null
    } catch {
        $passed=$false
        $reason=$_.Exception.Message
    }
    if ($passed -ne $case.pass) { $failures.Add("$($case.name): expected PASS=$($case.pass), got PASS=$passed ($reason)") }
    elseif (-not $passed -and $reason -notmatch 'arrow|marker') { $failures.Add("$($case.name): failed for unrelated reason: $reason") }
}
foreach ($p in $originalHashes.Keys) {
    if ((Get-FileHash -LiteralPath $p).Hash -ne $originalHashes[$p]) { throw "Source diagram modified: $p" }
}
if ($failures.Count) {
    $failures | Write-Output
    throw "$($failures.Count)/$($cases.Count) diagram arrow regression cases failed"
}
Write-Output "PASS: $($cases.Count) arrow regression cases; source diagrams unchanged."
