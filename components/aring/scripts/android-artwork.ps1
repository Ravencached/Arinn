# Deterministic resizing of the approved project bitmap for Android resources.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repository=[IO.Path]::GetFullPath((Join-Path $project '../..'))
$source=[Drawing.Bitmap]::new((Join-Path $project 'assets/logo.png'))
function Save-AringBitmap([string]$Path,[int]$Width,[int]$Height,[double]$Fraction,[bool]$Transparent,[string]$BackgroundShape='') {
    $bitmap=[Drawing.Bitmap]::new($Width,$Height)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    try {
        if ($Transparent) { $graphics.Clear([Drawing.Color]::Transparent) }
        else { $graphics.Clear([Drawing.Color]::FromArgb(247,247,241)) }
        if ($BackgroundShape) {
            $brush=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(247,247,241))
            try {
                if ($BackgroundShape -eq 'round') { $graphics.FillEllipse($brush,0,0,$Width,$Height) }
                else { $graphics.FillRectangle($brush,[int]($Width*0.04),[int]($Height*0.04),[int]($Width*0.92),[int]($Height*0.92)) }
            } finally { $brush.Dispose() }
        }
        $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $scale=[Math]::Min($Width*$Fraction/$source.Width,$Height*$Fraction/$source.Height)
        $w=[int]($source.Width*$scale); $h=[int]($source.Height*$scale)
        $graphics.DrawImage($source,[int](($Width-$w)/2),[int](($Height-$h)/2),$w,$h)
        $bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
try {
    foreach ($entry in @(@('mdpi',48,108),@('hdpi',72,162),@('xhdpi',96,216),@('xxhdpi',144,324),@('xxxhdpi',192,432))) {
        $directory=Join-Path $project "android/app/src/main/res/mipmap-$($entry[0])"
        Save-AringBitmap (Join-Path $directory 'ic_launcher.png') $entry[1] $entry[1] 0.8 $true 'square'
        Save-AringBitmap (Join-Path $directory 'ic_launcher_round.png') $entry[1] $entry[1] 0.7 $true 'round'
        Save-AringBitmap (Join-Path $directory 'ic_launcher_foreground.png') $entry[2] $entry[2] 0.64 $true
    }
    foreach ($path in Get-ChildItem (Join-Path $project 'android/app/src/main/res') -Filter splash.png -Recurse) {
        $existing=[Drawing.Bitmap]::new($path.FullName);$width=$existing.Width;$height=$existing.Height;$existing.Dispose()
        Save-AringBitmap $path.FullName $width $height 0.45 $false
    }
} finally { $source.Dispose() }
