import { authHeaders } from './authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export async function getKeyInfo(deviceId) {
  const res = await fetch(`${API_URL}/keys/${deviceId}`, { headers: authHeaders() });
  return parseResponse(res);
}

export async function rotateKey(deviceId) {
  const res = await fetch(`${API_URL}/keys/${deviceId}/rotate`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseResponse(res);
}

export async function rotateAllKeys() {
  const res = await fetch(`${API_URL}/keys/rotate-all`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseResponse(res);
}

async function parseResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'La operación no pudo completarse.');
  return data;
}
