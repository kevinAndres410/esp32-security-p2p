param(
    [ValidatePattern('^(?i:COM)\d+$')]
    [Parameter(Mandatory = $true)]
    [string]$Port,
    [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$buildDirectory = Join-Path $projectDirectory 'build'
$idfPath = 'C:\esp\v6.1-beta1\esp-idf'
$toolsPath = 'C:\Espressif\tools'
$cmake = Join-Path $toolsPath 'cmake\4.0.3\bin\cmake.exe'
$ninja = Join-Path $toolsPath 'ninja\1.12.1\ninja.exe'
$python = Join-Path $toolsPath 'python\v6.1-beta1\venv\Scripts\python.exe'
$compilerBin = Join-Path $toolsPath 'xtensa-esp-elf\esp-15.2.0_20251204\xtensa-esp-elf\bin'
$cCompiler = Join-Path $compilerBin 'xtensa-esp32s3-elf-gcc.exe'
$cxxCompiler = Join-Path $compilerBin 'xtensa-esp32s3-elf-g++.exe'

foreach ($required in $cmake, $ninja, $python, $cCompiler, $cxxCompiler) {
    if (-not (Test-Path -LiteralPath $required)) { throw "No se encontró $required" }
}

$env:IDF_PATH = $idfPath
$env:ESP_ROM_ELF_DIR = Join-Path $toolsPath 'esp-rom-elfs\20241011'
$env:PYTHONUTF8 = '1'
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = 'C:/esp/v6.1-beta1/esp-idf'
$env:PATH = ($compilerBin,
             (Join-Path $toolsPath 'cmake\4.0.3\bin'),
             (Join-Path $toolsPath 'ninja\1.12.1'),
             (Join-Path $toolsPath 'python\v6.1-beta1\venv\Scripts'),
             'C:\Program Files\Git\usr\bin' -join ';') + ';' + $env:PATH

& $cmake -G Ninja -S $projectDirectory -B $buildDirectory `
    -DPYTHON_DEPS_CHECKED=1 "-DPYTHON=$python" -DESP_PLATFORM=1 `
    -DIDF_TARGET=esp32s3 "-DCMAKE_C_COMPILER=$cCompiler" `
    "-DCMAKE_CXX_COMPILER=$cxxCompiler" "-DCMAKE_ASM_COMPILER=$cCompiler"
if ($LASTEXITCODE -ne 0) { throw 'Configuración ESP32-S3 fallida' }
& $ninja -C $buildDirectory
if ($LASTEXITCODE -ne 0) { throw 'Compilación ESP32-S3 fallida' }

if ($BuildOnly) { return }

$normalizedPort = $Port.ToUpperInvariant()
$readMac = & $python -m esptool --chip esp32s3 --port $normalizedPort `
    --before default-reset --after hard-reset read-mac 2>&1
if ($LASTEXITCODE -ne 0) { throw "No se pudo leer la placa en $normalizedPort" }
$macMatch = [regex]::Match(($readMac -join "`n"), '(?im)^MAC:\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s*$')
if (-not $macMatch.Success -or $macMatch.Groups[1].Value.ToUpperInvariant() -ne 'FC:01:2C:CB:36:50') {
    throw "MAC inesperada en $normalizedPort; no se grabó ningún firmware"
}

Push-Location $buildDirectory
try {
    & $python -m esptool --chip esp32s3 --port $normalizedPort `
        --before default-reset --after hard-reset write-flash '@flash_args'
} finally {
    Pop-Location
}
if ($LASTEXITCODE -ne 0) { throw "Grabación fallida en $normalizedPort" }
Write-Host "Firmware de laboratorio grabado en FC:01:2C:CB:36:50 por $normalizedPort"
