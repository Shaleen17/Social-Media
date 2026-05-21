Set-DnsClientServerAddress -InterfaceAlias "WiFi" -ServerAddresses ("1.1.1.1","8.8.8.8")
ipconfig /flushdns
Write-Host "DNS updated to Cloudflare (1.1.1.1) and Google (8.8.8.8)" -ForegroundColor Green
Write-Host "Current DNS:" -ForegroundColor Cyan
Get-DnsClientServerAddress -InterfaceAlias "WiFi" | Select-Object -ExpandProperty ServerAddresses
