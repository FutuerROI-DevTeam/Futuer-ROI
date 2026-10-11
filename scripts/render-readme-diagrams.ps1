# Export the small, uncompressed README draw.io diagrams without new dependencies.
# Supported primitives are plain-text rectangles and explicit-point arrows.
[CmdletBinding()]
param([switch]$Check)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$diagramDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs/diagrams'
function Escape-Xml([string]$value) { [System.Security.SecurityElement]::Escape($value) }
function Number([double]$value) { $value.ToString('0.###', [Globalization.CultureInfo]::InvariantCulture) }
$sources = @(Get-ChildItem -LiteralPath $diagramDirectory -Filter '*.drawio' | Sort-Object Name)
if (($sources.BaseName -join ',') -ne 'prediction-data-flow,system-architecture,today-meaning,user-flow') { throw 'Expected the four README diagrams.' }
foreach ($source in $sources) {
    $sourceText = [IO.File]::ReadAllText($source.FullName) -replace "`r`n", "`n"
    $xml = [xml]$sourceText
    $models = @($xml.SelectNodes('/mxfile/diagram/mxGraphModel'))
    if ($models.Count -ne 1) { throw "Expected one uncompressed diagram: $($source.Name)" }
    $model = $models[0]
    $ids = @($model.SelectNodes('root/mxCell') | ForEach-Object { $_.GetAttribute('id') })
    if (@($ids | Sort-Object -Unique).Count -ne $ids.Count -or '0' -notin $ids -or '1' -notin $ids) { throw 'Invalid or duplicate cell IDs.' }
    $width = [double]$model.GetAttribute('pageWidth')
    $height = [double]$model.GetAttribute('pageHeight')
    if ($width -le 0 -or $height -le 0) { throw 'Invalid page dimensions.' }
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($sourceText))).ToLowerInvariant()
    $title = Escape-Xml $model.ParentNode.GetAttribute('name')
    $titleId = Escape-Xml ($source.BaseName + '-title')
    $backgrounds = [Collections.Generic.List[string]]::new()
    $elements = [Collections.Generic.List[string]]::new()
    # Arrows go behind nodes; explicit coordinates preserve bends in the source.
    foreach ($cell in $model.SelectNodes('root/mxCell[@edge="1"]')) {
        if ($cell.GetAttribute('style') -ne 'endArrow=block;endFill=1;strokeColor=#526976;strokeWidth=2;') {
            throw 'Unsupported arrow style. Update exporter or export through diagrams.net.'
        }
        if ($cell.HasAttribute('source') -or $cell.HasAttribute('target') -or $cell.GetAttribute('value')) {
            throw "Connected or labelled edge needs diagrams.net SVG export: $($cell.GetAttribute('id'))"
        }
        $geometry = $cell.SelectSingleNode('mxGeometry')
        $points = @($geometry.SelectSingleNode('mxPoint[@as="sourcePoint"]')) + @($geometry.SelectNodes('Array/mxPoint')) + @($geometry.SelectSingleNode('mxPoint[@as="targetPoint"]'))
        if ($points.Count -lt 2 -or $points -contains $null) { throw 'Arrow has missing endpoints.' }
        $coordinates = ($points | ForEach-Object { "$(Number ([double]$_.GetAttribute('x'))),$(Number ([double]$_.GetAttribute('y')))" }) -join ' '
        $elements.Add("<polyline data-cell-id=`"$(Escape-Xml $cell.GetAttribute('id'))`" points=`"$coordinates`" fill=`"none`" stroke=`"#526976`" stroke-width=`"2`" marker-end=`"url(#arrow)`"/>")
    }
    foreach ($cell in $model.SelectNodes('root/mxCell[@vertex="1"]')) {
        $style = @{}
        foreach ($entry in $cell.GetAttribute('style').Split(';', [StringSplitOptions]::RemoveEmptyEntries)) {
            $pair = $entry.Split('=', 2)
            if ($pair.Count -eq 2) { $style[$pair[0]] = $pair[1] }
        }
        $supportedStyles = @('rounded','whiteSpace','html','fillColor','strokeColor','fontColor','fontSize','fontFamily','align','verticalAlign','spacing','fontStyle')
        foreach ($key in $style.Keys) { if ($key -notin $supportedStyles) { throw "Unsupported shape style: $key" } }
        if ($style['html'] -ne '0' -or $cell.GetAttribute('parent') -ne '1') { throw 'Unsupported HTML/grouped shape. Export through diagrams.net.' }
        if ($style['rounded'] -ne '1' -or $style['align'] -ne 'center' -or $style['verticalAlign'] -ne 'middle' -or $style['spacing'] -ne '12' -or $style['whiteSpace'] -ne 'wrap') { throw 'Unsupported shape layout.' }
        if ($style.ContainsKey('fontStyle') -and $style['fontStyle'] -notin @('0','1')) { throw 'Unsupported font style.' }
        $geometry = $cell.SelectSingleNode('mxGeometry')
        $x = [double]$geometry.GetAttribute('x'); $y = [double]$geometry.GetAttribute('y')
        $w = [double]$geometry.GetAttribute('width'); $h = [double]$geometry.GetAttribute('height')
        if ($x -lt 0 -or $y -lt 0 -or ($x+$w) -gt $width -or ($y+$h) -gt $height) { throw 'Shape exceeds page.' }
        $id = Escape-Xml $cell.GetAttribute('id')
        $fill = Escape-Xml $style['fillColor']; $stroke = Escape-Xml $style['strokeColor']
        $fontColor = Escape-Xml $style['fontColor']
        $fontFamily = Escape-Xml ($style['fontFamily'] + ', Meiryo, Noto Sans JP, sans-serif')
        if (-not $cell.GetAttribute('value')) {
            $backgrounds.Add("<rect data-cell-id=`"$id`" x=`"$(Number $x)`" y=`"$(Number $y)`" width=`"$(Number $w)`" height=`"$(Number $h)`" rx=`"12`" fill=`"$fill`" stroke=`"$stroke`"/>")
            continue
        }
        $elements.Add("<g data-cell-id=`"$id`"><rect x=`"$(Number $x)`" y=`"$(Number $y)`" width=`"$(Number $w)`" height=`"$(Number $h)`" rx=`"12`" fill=`"$fill`" stroke=`"$stroke`"/>")
        $value = $cell.GetAttribute('value')
        if ($value) {
            $lines = $value.Split("`n")
            $font = [double]$style['fontSize']; $lineHeight = $font * 1.4
            if ($font + ($lines.Count - 1) * $lineHeight -gt $h - 6) { throw "Text exceeds shape: $id" }
            $weight = if ($style['fontStyle'] -eq '1') { '600' } else { '400' }
            $top = $y + $h / 2 - ($lines.Count - 1) * $lineHeight / 2
            $elements.Add("<text text-anchor=`"middle`" dominant-baseline=`"central`" font-size=`"$(Number $font)`" font-weight=`"$weight`" font-family=`"$fontFamily`" fill=`"$fontColor`">")
            for ($i=0; $i -lt $lines.Count; $i++) {
                $elements.Add("<tspan x=`"$(Number ($x+$w/2))`" y=`"$(Number ($top+$i*$lineHeight))`">$(Escape-Xml $lines[$i])</tspan>")
            }
            $elements.Add('</text>')
        }
        $elements.Add('</g>')
    }
    $svg = @"
<svg xmlns="http://www.w3.org/2000/svg" width="$(Number $width)" height="$(Number $height)" viewBox="0 0 $(Number $width) $(Number $height)" role="img" aria-labelledby="$titleId" data-source-sha256="$hash">
<title id="$titleId">$title</title>
<desc>Future ROI main の説明図。編集元は同名 draw.io ファイル。</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#526976"/></marker></defs>
<rect width="100%" height="100%" rx="16" fill="#fafcfd"/>
<g font-family="Yu Gothic, Meiryo, Noto Sans JP, sans-serif">
$($backgrounds -join "`n")
$($elements -join "`n")
</g>
</svg>
"@ -replace "`r`n", "`n"
    $svg += "`n"
    $target = Join-Path $diagramDirectory ($source.BaseName + '.svg')
    [void]([xml]$svg)
    if ($Check) {
        if (-not (Test-Path -LiteralPath $target) -or ([IO.File]::ReadAllText($target) -replace "`r`n", "`n") -cne $svg) { throw "Stale SVG: $target" }
    } else { [IO.File]::WriteAllText($target, $svg, [Text.UTF8Encoding]::new($false)) }
    Write-Output "PASS: $($source.Name) -> $($source.BaseName).svg$(if ($Check) { ' (exact)' })"
}
