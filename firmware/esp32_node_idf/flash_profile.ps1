param(
    [ValidateSet('auto', 'gateway', 'node1', 'node2', 'node3')]
    [string]$Profile = 'auto',

    [ValidatePattern('^(?i:COM)\d+$')]
    [string]$Port,

    [switch]$Monitor
)

$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$pythonPath = 'C:\Espressif\tools\python\v6.1-beta1\venv\Scripts\python.exe'
$profileByMac = @{
    'B0:3F:D3:5B:50:B4' = 'gateway'
    '20:50:0D:17:C8:D0' = 'node1'
    '38:18:2B:8A:16:6C' = 'node2'
    '20:50:0D:17:EC:64' = 'node3'
}

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "No se encontró el entorno Python de ESP-IDF en $pythonPath"
}

function Get-AvailableSerialPorts {
    return @(
        [System.IO.Ports.SerialPort]::GetPortNames() |
            Sort-Object { [int]($_ -replace '\D', '') }
    )
}

function Select-SerialPort {
    param([string]$RequestedPort)

    $availablePorts = Get-AvailableSerialPorts
    if ($availablePorts.Count -eq 0) {
        throw 'No se detectó ningún puerto serie. Conecte el ESP32 y vuelva a ejecutar el comando.'
    }

    if ($RequestedPort) {
        $normalizedPort = $RequestedPort.ToUpperInvariant()
        if ($normalizedPort -notin $availablePorts) {
            throw "El puerto $normalizedPort no está disponible. Detectados: $($availablePorts -join ', ')"
        }
        return $normalizedPort
    }

    if ($availablePorts.Count -eq 1) {
        return $availablePorts[0]
    }

    Write-Host 'Puertos serie detectados (la identidad se verificará por MAC):'
    for ($index = 0; $index -lt $availablePorts.Count; $index++) {
        Write-Host "  [$($index + 1)] $($availablePorts[$index])"
    }

    while ($true) {
        $selection = Read-Host 'Seleccione el número del puerto'
        $selectedNumber = 0
        if ([int]::TryParse($selection, [ref]$selectedNumber) -and
            $selectedNumber -ge 1 -and $selectedNumber -le $availablePorts.Count) {
            return $availablePorts[$selectedNumber - 1]
        }
        Write-Warning 'Selección inválida.'
    }
}

function Get-BoardMac {
    param([string]$SelectedPort)

    $readMacOutput = & $pythonPath -m esptool --chip esp32 --port $SelectedPort `
        --before default-reset --after hard-reset read-mac 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudo leer la MAC de la placa conectada en $SelectedPort."
    }

    $match = [regex]::Match(
        ($readMacOutput -join [Environment]::NewLine),
        '(?im)^MAC:\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s*$'
    )
    if (-not $match.Success) {
        throw "esptool no devolvió una MAC válida para $SelectedPort."
    }

    return $match.Groups[1].Value.ToUpperInvariant()
}

$selectedPort = Select-SerialPort -RequestedPort $Port
$boardMac = Get-BoardMac -SelectedPort $selectedPort
$detectedProfile = $profileByMac[$boardMac]
if (-not $detectedProfile) {
    throw "La placa con MAC $boardMac no está registrada en el inventario. No se grabó ningún perfil."
}

if ($Profile -ne 'auto' -and $Profile -ne $detectedProfile) {
    throw "La MAC $boardMac corresponde a '$detectedProfile', no a '$Profile'. No se grabó ningún perfil."
}

$selectedProfile = $detectedProfile
Write-Host "MAC detectada: $boardMac"
Write-Host "Perfil identificado por MAC: $selectedProfile"
Write-Host "Puerto usado sólo para esta ejecución: $selectedPort"

& (Join-Path $projectDirectory 'build_profiles.ps1') -Profile $selectedProfile
if ($LASTEXITCODE -ne 0) { throw "No se pudo compilar el perfil $selectedProfile" }

$buildDirectory = Join-Path $projectDirectory 'build_gateway'

Push-Location $buildDirectory
try {
    & $pythonPath -m esptool --chip esp32 --port $selectedPort `
        --before default-reset --after hard-reset write-flash '@flash_args'
} finally {
    Pop-Location
}
if ($LASTEXITCODE -ne 0) { throw "La grabación del perfil $selectedProfile en $selectedPort falló" }

if ($Monitor) {
    & $pythonPath -m esp_idf_monitor -p $selectedPort -b 115200 --target esp32 `
        (Join-Path $buildDirectory 'esp32_node.elf')
}
