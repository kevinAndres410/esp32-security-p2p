const db = require('../models/db');
const { emitEstadoRed } = require('../websocket/socket');

function parsePerformancePayload(payload) {
  if (!payload.startsWith('{')) return {};
  try {
    const telemetry = JSON.parse(payload);
    return {
      heartbeatSequence: Number.isInteger(telemetry.hb) ? telemetry.hb : null,
      rttMs: Number.isFinite(telemetry.rtt) ? telemetry.rtt : null,
      freeHeap: Number.isInteger(telemetry.heap) ? telemetry.heap : null,
      minimumHeap: Number.isInteger(telemetry.minHeap) ? telemetry.minHeap : null,
      cpuPercent: Number.isInteger(telemetry.cpuX100)
        ? telemetry.cpuX100 / 100
        : (Number.isFinite(telemetry.cpu) ? telemetry.cpu : null),
      uptimeMs: Number.isInteger(telemetry.uptime) ? telemetry.uptime : null,
    };
  } catch {
    return {};
  }
}

function sync(req, res) {
  if (req.nodo.admission_status !== 'approved') {
    return res.status(403).json({ error: 'Nodo pendiente de aprobación' });
  }
  const { deviceId, sequence, type, payload } = req.body || {};
  if (deviceId !== req.nodo.device_id) {
    return res.status(400).json({ error: 'deviceId no coincide con el nodo autenticado' });
  }
  if (!Number.isInteger(sequence) || !Number.isInteger(type) || typeof payload !== 'string') {
    return res.status(400).json({ error: 'Trama de gateway inválida' });
  }

  db.prepare(`UPDATE nodos SET estado = 'activo', ultima_actividad = CURRENT_TIMESTAMP WHERE device_id = ?`)
    .run(deviceId);
  db.prepare(`UPDATE kits SET gateway_last_seen_at = CURRENT_TIMESTAMP
    WHERE id IN (SELECT kit_id FROM kit_devices WHERE device_id = ?)`).run(deviceId);
  db.prepare(`UPDATE kit_device_operations SET status = 'online', first_seen_at = CURRENT_TIMESTAMP
    WHERE device_id = ? AND status = 'awaiting_telemetry' AND action IN ('add', 'replace')
      AND config_version <= (SELECT applied_version FROM kits
        WHERE kits.id = kit_device_operations.kit_id)`).run(deviceId);

  const telemetry = parsePerformancePayload(payload);
  db.prepare(`INSERT OR IGNORE INTO muestras_rendimiento
    (device_id, secuencia_protocolo, secuencia_heartbeat, recibido_en, rtt_ms,
     heap_libre_bytes, heap_minimo_bytes, cpu_porcentaje, uptime_ms, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      deviceId,
      sequence,
      telemetry.heartbeatSequence ?? null,
      new Date().toISOString(),
      telemetry.rttMs ?? null,
      telemetry.freeHeap ?? null,
      telemetry.minimumHeap ?? null,
      telemetry.cpuPercent ?? null,
      telemetry.uptimeMs ?? null,
      payload,
    );

  // Firmar correctamente con la clave nueva confirma el cambio y permite
  // retirar definitivamente la clave anterior.
  if (req.versionClave === 'actual' && req.nodo.clave_anterior) {
    db.prepare('UPDATE nodos SET clave_anterior = NULL WHERE device_id = ?').run(deviceId);
    db.prepare('INSERT INTO eventos (tipo, mensaje, nodo_id) VALUES (?, ?, ?)')
      .run('rotacion_confirmada', `Rotación confirmada por ${deviceId}`, deviceId);
  }

  const commands = [];
  if (req.versionClave === 'anterior') {
    commands.push({ deviceId, type: 'rotate_key', payload: req.nodo.clave_actual });
  }
  emitEstadoRed();
  return res.json({ commands });
}

module.exports = { sync };
