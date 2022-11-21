function ConvertTo-JsonUnicodeEscape([string]$String) {
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($String)
    $count = $bytes.Count
    $res = for ($i = 0; $i -lt $count; $i += 2) {
        $low = $bytes[$i]
        $high = $bytes[$i + 1]
        if ($high -eq 0) {
            [char]$low
        } else {
            '\u{0:x2}{1:x2}' -f ($high, $low)
        }
    }
    $res -join ''
}

function ConvertTo-SafeEncodeJson() {
    param(
        [object][Parameter(Mandatory, Position=0, ValueFromPipeline)] $InputObject,
        [switch] $Compress,
        [int] $Depth = 2
    )
    Begin {
        $array = @()
    }
    Process {
        $array += $InputObject
    }
    End {
        if ($array.Count -gt 1) {
            $InputObject = $array
        }
        $json = ConvertTo-Json $InputObject -Compress:$Compress -Depth:$Depth
        ConvertTo-JsonUnicodeEscape $json
    }
}

Export-ModuleMember -Function @(
    'ConvertTo-SafeEncodeJson'
)
