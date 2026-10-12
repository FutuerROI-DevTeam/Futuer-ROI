# Read-only structural check for the two approved document diagrams.
# This does not render draw.io, prove pixel equivalence, or export new SVGs.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$directory = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs/diagrams'
function Number([string]$value) {
    [double]::Parse($value, [Globalization.CultureInfo]::InvariantCulture)
}
function Check([bool]$ok, [string]$message) {
    if (-not $ok) {
        throw $message
    }
}
function Style($cell) {
    $out = @{}
    foreach ($entry in $cell.GetAttribute('style').Split(';', [StringSplitOptions]::RemoveEmptyEntries)) {
        $pair = $entry.Split('=', 2)
        $out[$pair[0]] = if ($pair.Count -eq 2) { $pair[1] } else { '1' }
    }
    return $out
}
function Numbers([string]$value) {
    return @([regex]::Matches($value, '-?\d+(?:\.\d+)?') | ForEach-Object { Number $_.Value })
}
function SameNumbers($a, $b) {
    if ($a.Count -ne $b.Count) {
        return $false
    }
    for ($i=0; $i -lt $a.Count; $i++) {
        if ([Math]::Abs($a[$i]-$b[$i]) -gt 0.001) {
            return $false
        }
    }
    return $true
}
function CheckArrow($svg, $style, $edge, [string]$side, [string]$context) {
    $key = "${side}Arrow"
    # Missing startArrow means none; an end style must be explicit rather
    # than guessing draw.io's default end-arrow type.
    Check ($side -ne 'end' -or $style.ContainsKey($key)) "$context missing end arrow style"
    $kind = if ($style.ContainsKey($key)) { $style[$key] } else { 'none' }
    Check ($kind -cin @('none','block')) "$context unsupported $side arrow type: $kind"
    $reference = $edge.GetAttribute("marker-$side")
    if ($kind -eq 'none') {
        Check ($reference -in @('','none')) "$context $side arrow differs"
        return
    }
    Check ($reference -cmatch '^url\(#([A-Za-z_][\w.-]*)\)$') "$context $side arrow marker differs"
    $markerId = $Matches[1]
    $markers = @($svg.SelectNodes('/*[local-name()="svg"]/*[local-name()="defs"]/*[local-name()="marker"]') | Where-Object { $_.GetAttribute('id') -ceq $markerId })
    Check ($markers.Count -eq 1) "$context $side arrow marker missing or ambiguous"
    $paths = @($markers[0].SelectNodes('*[local-name()="path"]'))
    Check ($paths.Count -eq 1 -and $markers[0].ChildNodes.Count -eq 1) "$context unsupported $side arrow marker shape"
    $d = $paths[0].GetAttribute('d')
    Check (
        ($d -replace '[^A-Za-z]','') -ceq 'MLLZ' -and
        (SameNumbers (Numbers $d) @(1,1,9,5,1,9)) -and
        $paths[0].GetAttribute('fill') -notin @('','none')
    ) "$context $side arrow marker is not a filled block"
    Check ($markers[0].GetAttribute('orient') -ceq 'auto-start-reverse') "$context unsupported $side arrow marker orientation"
}
function Geometry($cell, [int]$depth=0) {
    Check ($depth -lt $byId.Count) 'Cyclic source parent hierarchy'
    $g=$cell.SelectSingleNode('mxGeometry').CloneNode($true)
    $parent=$cell.GetAttribute('parent')
    if ($parent -notin @('0','1')) {
        Check ($byId.ContainsKey($parent)) 'Missing source parent'
        $pg=Geometry $byId[$parent] ($depth+1)
        foreach ($axis in @('x','y')) {
            $g.SetAttribute($axis, ((Number $g.GetAttribute($axis))+(Number $pg.GetAttribute($axis))).ToString('R',[Globalization.CultureInfo]::InvariantCulture))
        }
    }
    return $g
}
foreach ($name in @('system-architecture','user-flow')) {
    $source = [xml][IO.File]::ReadAllText((Join-Path $directory "$name.drawio"))
    $svg = [xml][IO.File]::ReadAllText((Join-Path $directory "$name.svg"))
    $models = @($source.SelectNodes('/mxfile/diagram/mxGraphModel'))
    Check ($models.Count -eq 1) "$name needs one uncompressed page"
    $model = $models[0]
    $width = Number $model.GetAttribute('pageWidth')
    $height = Number $model.GetAttribute('pageHeight')
    Check ((Number $svg.DocumentElement.GetAttribute('width')) -eq $width -and (Number $svg.DocumentElement.GetAttribute('height')) -eq $height) "$name page sizes differ"
    Check (@($svg.SelectNodes('//*[local-name()="script" or local-name()="image" or local-name()="foreignObject"]')).Count -eq 0) "$name contains active or external SVG content"
    Check (@($svg.SelectNodes('//@*[local-name()="href"]')).Count -eq 0) "$name contains external SVG references"
    $cells = @($model.SelectNodes('root/mxCell'))
    $byId = @{}
    foreach ($cell in $cells) {
        $id=$cell.GetAttribute('id')
        Check (-not $byId.ContainsKey($id)) "$name duplicate cell $id"
        $byId[$id]=$cell
    }
    $texts = @($svg.SelectNodes('//*[local-name()="text"]'))
    $usedText = [Collections.Generic.HashSet[string]]::new()
    $vertices = @($model.SelectNodes('root/mxCell[@vertex="1"]'))
    foreach ($cell in $vertices) {
        $id=$cell.GetAttribute('id')
        $g=Geometry $cell
        $style=Style $cell
        Check ($style['html'] -eq '0') "$name unsupported HTML vertex $id"
        $x=Number $g.GetAttribute('x')
        $y=Number $g.GetAttribute('y')
        $w=Number $g.GetAttribute('width')
        $h=Number $g.GetAttribute('height')
        Check ($x -ge 0 -and $y -ge 0 -and $w -gt 0 -and $h -gt 0 -and $x+$w -le $width -and $y+$h -le $height) "$name vertex outside page: $id"
        # Compare logical label lines; normalize optional escaped newlines.
        # This check does not execute the native draw.io editor.
        $value=$cell.GetAttribute('value').Replace('\n',"`n")
        if ($value) {
            $font=Number $style['fontSize']
            foreach ($line in $value.Split("`n")) {
                $candidates=@($texts | Where-Object { $_.InnerText -ceq $line -and [Math]::Abs((Number $_.GetAttribute('x'))-($x+$w/2)) -lt 0.001 -and (Number $_.GetAttribute('font-size')) -eq $font })
                Check ($candidates.Count -eq 1) "$name label/font/center differs: $id ($line)"
                $t=$candidates[0]
                $ty=Number $t.GetAttribute('y')
                Check ($ty -ge $y -and $ty -le $y+$h) "$name text baseline outside source box: $id"
                Check ($usedText.Add($t.OuterXml)) "$name reused SVG text: $id"
            }
        }
        if (-not $style.ContainsKey('text')) {
            if ($style.ContainsKey('rhombus')) {
                $expected=@(($x+$w/2),$y,($x+$w),($y+$h/2),($x+$w/2),($y+$h),$x,($y+$h/2))
                $matches=@($svg.SelectNodes('/*[local-name()="svg"]/*[local-name()="path"]') | Where-Object { SameNumbers (Numbers $_.GetAttribute('d')) $expected })
            } elseif ($style['shape'] -in @('cylinder','cylinder3')) {
                $expected=@($x,($y+15),$x,($y-5),($x+$w),($y-5),($x+$w),($y+15),($x+$w),($y+$h-15),($x+$w),($y+$h+5),$x,($y+$h+5),$x,($y+$h-15),$x,($y+15),$x,($y+35),($x+$w),($y+35),($x+$w),($y+15))
                $matches=@($svg.SelectNodes('/*[local-name()="svg"]/*[local-name()="path"]') | Where-Object { SameNumbers (Numbers $_.GetAttribute('d')) $expected })
            } else {
                $matches=@($svg.SelectNodes('//*[local-name()="rect" and @x]') | Where-Object { SameNumbers @((Number $_.GetAttribute('x')),(Number $_.GetAttribute('y')),(Number $_.GetAttribute('width')),(Number $_.GetAttribute('height'))) @($x,$y,$w,$h) })
            }
            Check ($matches.Count -eq 1) "$name shape geometry differs: $id"
        }
    }
    Check ($usedText.Count -eq $texts.Count) "$name extra/missing SVG labels"
    # Identify unfilled edge paths independently of their arrowheads.
    $edges=@($model.SelectNodes('root/mxCell[@edge="1"]'))
    $svgEdges=@($svg.SelectNodes('/*[local-name()="svg"]/*[local-name()="path" and @fill="none"]'))
    Check ($edges.Count -eq $svgEdges.Count) "$name edge counts differ"
    foreach ($cell in $edges) {
        Check ($cell.GetAttribute('parent') -eq '1') "$name unsupported grouped edge waypoints"
        $style=Style $cell
        $from=Geometry $byId[$cell.GetAttribute('source')]
        $to=Geometry $byId[$cell.GetAttribute('target')]
        $points=@(((Number $from.GetAttribute('x'))+(Number $style['exitX'])*(Number $from.GetAttribute('width'))),((Number $from.GetAttribute('y'))+(Number $style['exitY'])*(Number $from.GetAttribute('height'))))
        foreach ($point in $cell.SelectNodes('mxGeometry/Array/mxPoint')) {
            $points+=@((Number $point.GetAttribute('x')),(Number $point.GetAttribute('y')))
        }
        $points+=@(((Number $to.GetAttribute('x'))+(Number $style['entryX'])*(Number $to.GetAttribute('width'))),((Number $to.GetAttribute('y'))+(Number $style['entryY'])*(Number $to.GetAttribute('height'))))
        $matches=@($svgEdges | Where-Object { SameNumbers (Numbers $_.GetAttribute('d')) $points })
        Check ($matches.Count -eq 1) "$name edge path differs: $($cell.GetAttribute('id'))"
        CheckArrow $svg $style $matches[0] 'start' "$name edge $($cell.GetAttribute('id'))"
        CheckArrow $svg $style $matches[0] 'end' "$name edge $($cell.GetAttribute('id'))"
    }
    Write-Output "PASS: $name labels $($texts.Count), vertices $($vertices.Count), edges $($edges.Count); page bounds and SVG/source structure."
}
