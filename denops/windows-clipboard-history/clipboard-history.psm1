Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.ApplicationModel.DataTransfer.Clipboard, Windows.ApplicationModel.DataTransfer, ContentType = WindowsRuntime]

[System.Reflection.MethodInfo]$script:asTaskGeneric = (
    [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    }
)[0]

function Await([System.MarshalByRefObject]$WinRTTask, [System.Reflection.TypeInfo]$ResultType) {
    $asTask = $script:asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRTTask))
    [void]$netTask.Wait(-1)
    $netTask.Result
}

function GetHistoryItems() {
    (Await `
        -WinRTTask ([Windows.ApplicationModel.DataTransfer.Clipboard]::GetHistoryItemsAsync()) `
        -ResultType ([Windows.ApplicationModel.DataTransfer.ClipboardHistoryItemsResult])
    ).Items
}

function Get-ClipboardHistory() {
    GetHistoryItems | Where-Object {
        $_.Content.Contains([Windows.ApplicationModel.DataTransfer.StandardDataFormats]::Text)
    } | ForEach-Object {
        $text = Await -WinRTTask ($_.Content.GetTextAsync()) -ResultType ([string])
        [PSCustomObject]@{
            Id = $_.Id
            Text = $text
            Time = $_.Timestamp.ToUnixTimeMilliseconds()
        }
    }
}

Export-ModuleMember -Function @(
    'Get-ClipboardHistory'
)
