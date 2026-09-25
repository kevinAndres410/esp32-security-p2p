param(
    [ValidateSet('gateway', 'node1', 'node2', 'node3', 'all')]
    [string]$Profile = 'all',
    [string]$KitConfig = '',
    [ValidatePattern('^[A-Za-z0-9_-]+$')]
    [string]$KitId = '',
    [switch]$EnableBle
)

$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
if ($KitConfig -and -not $KitId) { throw 'KitId is required when KitConfig is provided' }
if ($KitConfig -and -not (Test-Path -LiteralPath $KitConfig -PathType Leaf)) { throw "Kit configuration not found: $KitConfig" }
if ($KitConfig) { $KitConfig = (Resolve-Path -LiteralPath $KitConfig).Path }
$buildDirectory = Join-Path $projectDirectory $(if ($KitId) { "build_$KitId" } else { 'build_gateway' })
$artifactRoot = Join-Path $projectDirectory $(if ($KitId) { "artifacts\$KitId" } else { 'artifacts' })
$sdkconfigOptions = if ($EnableBle) {
    @("-DSDKCONFIG=$(Join-Path $buildDirectory 'sdkconfig_ble')",
      "-DSDKCONFIG_DEFAULTS=$(Join-Path $projectDirectory 'sdkconfig.defaults');$(Join-Path $projectDirectory 'sdkconfig.ble.defaults')")
} else { @() }
$profiles = if ($Profile -eq 'all') { 'gateway', 'node1', 'node2', 'node3' } else { $Profile }

$idfPath = 'C:\esp\v6.1-beta1\esp-idf'
$toolsPath = 'C:\Espressif\tools'
$cmake = Join-Path $toolsPath 'cmake\4.0.3\bin\cmake.exe'
$ninja = Join-Path $toolsPath 'ninja\1.12.1\ninja.exe'
$python = Join-Path $toolsPath 'python\v6.1-beta1\venv\Scripts\python.exe'
$compilerBin = Join-Path $toolsPath 'xtensa-esp-elf\esp-15.2.0_20251204\xtensa-esp-elf\bin'
$cCompiler = Join-Path $compilerBin 'xtensa-esp32-elf-gcc.exe'
$cxxCompiler = Join-Path $compilerBin 'xtensa-esp32-elf-g++.exe'

foreach ($required in $cmake, $ninja, $python, $cCompiler, $cxxCompiler) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required ESP-IDF tool not found: $required"
    }
}

$env:IDF_PATH = $idfPath
$env:ESP_IDF_VERSION = '6.1.0'
$env:ESP_ROM_ELF_DIR = Join-Path $toolsPath 'esp-rom-elfs\20241011'
$env:PYTHONUTF8 = '1'
$env:GIT_CONFIG_COUNT = '3'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = 'C:/esp/v6.1-beta1/esp-idf'
$env:GIT_CONFIG_KEY_1 = 'safe.directory'
$env:GIT_CONFIG_VALUE_1 = 'C:/esp/v6.1-beta1/esp-idf/components/openthread/openthread'
$env:GIT_CONFIG_KEY_2 = 'safe.directory'
$env:GIT_CONFIG_VALUE_2 = ($projectDirectory -replace '\\', '/')
$env:PATH = ($compilerBin,
             (Join-Path $toolsPath 'cmake\4.0.3\bin'),
             (Join-Path $toolsPath 'ninja\1.12.1'),
             (Join-Path $toolsPath 'python\v6.1-beta1\venv\Scripts'),
             'C:\Program Files\Git\usr\bin' -join ';') + ';' + $env:PATH

foreach ($currentProfile in $profiles) {
    Write-Host "Configuring profile $currentProfile..."
    & $cmake -G Ninja -S $projectDirectory -B $buildDirectory `
        -DPYTHON_DEPS_CHECKED=1 `
        "-DPYTHON=$python" `
        -DESP_PLATFORM=1 `
        "-DFIRMWARE_PROFILE=$currentProfile" `
        "-DKIT_CONFIG_C=$KitConfig" `
        @sdkconfigOptions `
        "-DCMAKE_C_COMPILER=$cCompiler" `
        "-DCMAKE_CXX_COMPILER=$cxxCompiler" `
        "-DCMAKE_ASM_COMPILER=$cCompiler"
    if ($LASTEXITCODE -ne 0) { throw "Configure failed for profile $currentProfile" }

    & $ninja -C $buildDirectory
    if ($LASTEXITCODE -ne 0) { throw "Build failed for profile $currentProfile" }

    $artifactDirectory = Join-Path $artifactRoot $currentProfile
    New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
    Copy-Item -LiteralPath (Join-Path $buildDirectory 'bootloader\bootloader.bin') `
        -Destination (Join-Path $artifactDirectory 'bootloader.bin') -Force
    Copy-Item -LiteralPath (Join-Path $buildDirectory 'partition_table\partition-table.bin') `
        -Destination (Join-Path $artifactDirectory 'partition-table.bin') -Force
    Copy-Item -LiteralPath (Join-Path $buildDirectory 'esp32_node.bin') `
        -Destination (Join-Path $artifactDirectory 'esp32_node.bin') -Force
}
