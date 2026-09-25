const fs = require('fs');
const path = require('path');
const db = require('../src/models/db');

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const durationSeconds = Number(option('--duration', '180'));
const label = option('--label', 'tres-nodos-simultaneos');
const distance = option('--distance', 'misma-habitacion');
const fromOption = option('--from', null);
const toOption = option('--to', null);
if (!toOption && (!Number.isFinite(durationSeconds) || durationSeconds < 20)) {
  throw new Error('--duration debe ser un número de segundos mayor o igual a 20');
}

const allDevices = db.prepare(
  'SELECT device_id, mac_address FROM nodos WHERE mac_address IS NOT NULL ORDER BY device_id',
).all();
const deviceSelection = option('--devices', 'all');
const selectedIds = deviceSelection === 'all' ? null : new Set(deviceSelection.split(','));
const expectedDevices = selectedIds
  ? allDevices.filter((device) => selectedIds.has(device.device_id))
  : allDevices;
if (!expectedDevices.length || (selectedIds && expectedDevices.length !== selectedIds.size)) {
  throw new Error('La selección --devices no coincide con los nodos registrados');
}
const startedAt = fromOption ? new Date(fromOption) : new Date();
if (Number.isNaN(startedAt.getTime()) || (toOption && Number.isNaN(new Date(toOption).getTime()))) {
  throw new Error('--from/--to deben ser fechas ISO válidas');
}
const startIso = startedAt.toISOString();

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * ordered.length) - 1;
  return ordered[Math.max(0, index)];
}

function round(value, digits = 2) {
  return value === null ? null : Number(value.toFixed(digits));
}

function summarizeDevice(device, rows) {
  const samples = rows.filter((row) => row.device_id === device.device_id &&
    (row.secuencia_heartbeat !== null || row.payload === 'online'));
  const heartbeatNumbers = samples
    .map((row) => row.secuencia_heartbeat)
    .filter(Number.isInteger);
  const rtts = samples.map((row) => row.rtt_ms).filter((value) => Number.isFinite(value) && value >= 0);
  const cpu = samples.map((row) => row.cpu_porcentaje).filter(Number.isFinite);
  const heaps = samples.map((row) => row.heap_libre_bytes).filter(Number.isInteger);
  const minimumHeaps = samples.map((row) => row.heap_minimo_bytes).filter(Number.isInteger);
  const arrivals = samples.map((row) => new Date(row.recibido_en).getTime()).sort((a, b) => a - b);
  const intervals = arrivals.slice(1).map((time, index) => time - arrivals[index]);

  let expectedPackets = null;
  let missingPackets = null;
  let lossPercent = null;
  let rebootEpochs = 0;
  if (heartbeatNumbers.length >= 2) {
    missingPackets = 0;
    rebootEpochs = 1;
    for (let index = 1; index < heartbeatNumbers.length; index++) {
      const difference = heartbeatNumbers[index] - heartbeatNumbers[index - 1];
      if (difference > 1) missingPackets += difference - 1;
      if (difference <= 0) rebootEpochs++;
    }
    expectedPackets = heartbeatNumbers.length + missingPackets;
    lossPercent = expectedPackets ? (missingPackets * 100) / expectedPackets : null;
  }

  return {
    deviceId: device.device_id,
    mac: device.mac_address,
    receivedPackets: samples.length,
    expectedPackets,
    missingPackets,
    lossPercent: round(lossPercent),
    rebootEpochs: rebootEpochs || null,
    latencyRttMs: rtts.length ? {
      minimum: Math.min(...rtts),
      average: round(rtts.reduce((sum, value) => sum + value, 0) / rtts.length),
      p50: percentile(rtts, 50),
      p95: percentile(rtts, 95),
      maximum: Math.max(...rtts),
    } : null,
    interarrivalMs: intervals.length ? {
      average: round(intervals.reduce((sum, value) => sum + value, 0) / intervals.length),
      p95: percentile(intervals, 95),
      maximum: Math.max(...intervals),
    } : null,
    memoryBytes: heaps.length ? {
      averageFree: Math.round(heaps.reduce((sum, value) => sum + value, 0) / heaps.length),
      minimumFree: Math.min(...heaps),
      minimumEver: minimumHeaps.length ? Math.min(...minimumHeaps) : null,
    } : null,
    cpuPercent: cpu.length ? {
      average: round(cpu.reduce((sum, value) => sum + value, 0) / cpu.length),
      p95: percentile(cpu, 95),
      maximum: Math.max(...cpu),
    } : null,
  };
}

function writeReport(finishedAt = new Date()) {
  const rows = db.prepare(`SELECT * FROM muestras_rendimiento
    WHERE recibido_en >= ? AND recibido_en <= ?
      AND (secuencia_heartbeat IS NOT NULL OR payload = 'online')
    ORDER BY recibido_en`).all(startIso, finishedAt.toISOString())
    .filter((row) => expectedDevices.some((device) => device.device_id === row.device_id));
  const devices = expectedDevices.map((device) => summarizeDevice(device, rows));
  const arrivalsByDevice = new Map(expectedDevices.map((device) => [device.device_id, []]));
  for (const row of rows) arrivalsByDevice.get(row.device_id)?.push(new Date(row.recibido_en).getTime());
  let simultaneousSeconds = 0;
  const measurementStart = startedAt.getTime() + 20000;
  const totalMeasuredSeconds = Math.max(0, Math.floor((finishedAt.getTime() - measurementStart) / 1000));
  for (let second = 0; second < totalMeasuredSeconds; second++) {
    const time = measurementStart + second * 1000;
    if (expectedDevices.every((device) => arrivalsByDevice.get(device.device_id)
      .some((arrival) => arrival <= time && time - arrival <= 25000))) {
      simultaneousSeconds++;
    }
  }

  const report = {
    label,
    distance,
    startedAt: startIso,
    finishedAt: finishedAt.toISOString(),
    durationSeconds: round((finishedAt - startedAt) / 1000),
    expectedDeviceCount: expectedDevices.length,
    totalReceivedPackets: rows.length,
    aggregateThroughputPacketsPerSecond: round(rows.length / ((finishedAt - startedAt) / 1000), 4),
    simultaneousPresencePercent: totalMeasuredSeconds
      ? round((simultaneousSeconds * 100) / totalMeasuredSeconds)
      : null,
    devices,
    notes: [
      'RTT incluye nodo, ESP-NOW, gateway, petición/respuesta HTTP del backend y ACK de regreso.',
      'La pérdida es de saltos de secuencia entre paquetes recibidos por cada arranque; no incluye pérdidas anteriores/posteriores ni durante reinicios.',
      'La presencia simultánea se calcula cada segundo con una tolerancia de 25 s, tras 20 s de calentamiento.',
      'El consumo de energía requiere corriente y voltaje de un medidor externo; no se estima por software.',
    ],
  };

  const outputDirectory = path.join(__dirname, '../../resultados_rendimiento');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const baseName = `${stamp}-${label}`;
  const jsonPath = path.join(outputDirectory, `${baseName}.json`);
  const markdownPath = path.join(outputDirectory, `${baseName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    `# Prueba de rendimiento: ${label}`,
    '',
    `- Inicio: ${report.startedAt}`,
    `- Fin: ${report.finishedAt}`,
    `- Duración: ${report.durationSeconds} s`,
    `- Escenario/distancia: ${distance}`,
    `- Paquetes recibidos: ${report.totalReceivedPackets}`,
    `- Rendimiento agregado: ${report.aggregateThroughputPacketsPerSecond} paquetes/s`,
    `- Presencia simultánea de los ${expectedDevices.length} nodo(s) seleccionados: ${report.simultaneousPresencePercent}%`,
    '',
    '| Nodo | MAC | Recibidos | Pérdidos | Pérdida | RTT prom./p95/máx. (ms) | CPU prom./p95 | Heap libre mínimo |',
    '|---|---|---:|---:|---:|---|---|---:|',
    ...devices.map((device) => `| ${device.deviceId} | ${device.mac} | ${device.receivedPackets} | ${device.missingPackets ?? 'N/D'} | ${device.lossPercent === null ? 'N/D' : `${device.lossPercent}%`} | ${device.latencyRttMs ? `${device.latencyRttMs.average} / ${device.latencyRttMs.p95} / ${device.latencyRttMs.maximum}` : 'N/D'} | ${device.cpuPercent ? `${device.cpuPercent.average}% / ${device.cpuPercent.p95}%` : 'N/D'} | ${device.memoryBytes?.minimumFree ?? 'N/D'} |`),
    '',
    ...report.notes.map((note) => `- ${note}`),
    '',
  ];
  fs.writeFileSync(markdownPath, lines.join('\n'));
  db.close();
  console.log(JSON.stringify({ jsonPath, markdownPath, report }, null, 2));
}

console.log(`Monitoreo '${label}' iniciado por ${durationSeconds} s para ${expectedDevices.length} nodos.`);
if (toOption) writeReport(new Date(toOption));
else setTimeout(writeReport, durationSeconds * 1000);
