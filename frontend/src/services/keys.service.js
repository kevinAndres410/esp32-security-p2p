import { authHeaders } from './authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export async function getKeyInfo(deviceId) {
  const res = await fetch(`${API_URL}/keys/${deviceId}`, { headers: authHeaders() });
  return res.json();
}

export async function rotateKey(deviceId) {
  const res = await fetch(`${API_URL}/keys/${deviceId}/rotate`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return res.json();
}
