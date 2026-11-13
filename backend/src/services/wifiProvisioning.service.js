const ALLOWED_SECURITY = new Set(['WPA2', 'WPA3', 'WPA2_WPA3', 'OPEN']);

function validateWifiInput({ ssid, password, securityType }) {
  const normalized = {
    ssid: String(ssid || '').trim(),
    password: String(password || ''),
    securityType: String(securityType || '').toUpperCase(),
  };
  if (!normalized.ssid || Buffer.byteLength(normalized.ssid, 'utf8') > 32) {
    throw new Error('El SSID debe tener entre 1 y 32 bytes');
  }
  if (!ALLOWED_SECURITY.has(normalized.securityType)) throw new Error('Tipo de seguridad no permitido');
  if (normalized.securityType === 'OPEN') normalized.password = '';
  else if (normalized.password.length < 8 || normalized.password.length > 63) {
    throw new Error('La contraseña Wi-Fi debe tener entre 8 y 63 caracteres');
  }
  return normalized;
}

async function testWifiConnection(config) {
  const endpoint = String(process.env.WIFI_PROVISIONING_URL || '').replace(/\/$/, '');
  if (!endpoint) {
    return {
      ok: false,
      status: 'unavailable',
      message: 'El adaptador de aprovisionamiento del Gateway no está configurado.',
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${endpoint}/test`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-provisioning-secret': process.env.WIFI_PROVISIONING_SECRET || '',
      },
      body: JSON.stringify(config),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok && body.connected === true,
      status: response.ok && body.connected === true ? 'connected' : 'error',
      message: body.message || (response.ok ? 'El Gateway no confirmó la conexión.' : 'El Gateway rechazó la prueba.'),
    };
  } catch (error) {
    return { ok: false, status: 'error', message: error.name === 'AbortError' ? 'La prueba excedió 10 segundos.' : 'No se pudo contactar al Gateway.' };
  } finally {
    clearTimeout(timeout);
  }
}

async function applyWifiConfiguration(config) {
  const endpoint = String(process.env.WIFI_PROVISIONING_URL || '').replace(/\/$/, '');
  if (!endpoint) return { ok: false, status: 'unavailable', message: 'El adaptador del Gateway no está configurado.' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${endpoint}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-provisioning-secret': process.env.WIFI_PROVISIONING_SECRET || '' },
      body: JSON.stringify(config),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    // En un kit concreto no basta una respuesta genérica: el adaptador debe
    // confirmar expresamente el Gateway al que aplicó las credenciales.
    const targetConfirmed = !config.gatewayIdentifier || body.gatewayIdentifier === config.gatewayIdentifier;
    const ok = response.ok && body.applied === true && body.connected === true && targetConfirmed;
    return { ok, status: ok ? 'connected' : 'error', message: !targetConfirmed
      ? 'El adaptador no confirmó que aplicó la red al Gateway de este kit.'
      : body.message || (ok ? 'Gateway conectado a la red.' : 'El Gateway no confirmó la nueva conexión.') };
  } catch (error) {
    return { ok: false, status: 'error', message: error.name === 'AbortError' ? 'La aplicación excedió 10 segundos.' : 'No se pudo contactar al Gateway.' };
  } finally { clearTimeout(timeout); }
}

module.exports = { validateWifiInput, testWifiConnection, applyWifiConfiguration, ALLOWED_SECURITY };
