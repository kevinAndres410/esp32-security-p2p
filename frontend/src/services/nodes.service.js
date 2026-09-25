import { authHeaders } from './authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export async function getNodes() {
  const res = await fetch(`${API_URL}/nodes`, { headers: authHeaders() });
  return parseResponse(res);
}

export async function registerNode({ deviceId, macAddress, descripcion }) {
  const res = await fetch(`${API_URL}/nodes`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ deviceId, macAddress, descripcion }),
  });
  return parseResponse(res);
}

export async function blockNode(deviceId) {
  const res = await fetch(`${API_URL}/nodes/${deviceId}/block`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  return parseResponse(res);
}

export async function unblockNode(deviceId) {
  const res = await fetch(`${API_URL}/nodes/${deviceId}/unblock`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  return parseResponse(res);
}

export async function deleteNode(deviceId) {
  const res = await fetch(`${API_URL}/nodes/${deviceId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return parseResponse(res);
}

async function parseResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'La operación no pudo completarse.');
  return data;
}
