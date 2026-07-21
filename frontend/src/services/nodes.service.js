import { authHeaders } from './authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export async function getNodes() {
  const res = await fetch(`${API_URL}/nodes`, { headers: authHeaders() });
  return res.json();
}

export async function registerNode({ deviceId, descripcion }) {
  const res = await fetch(`${API_URL}/nodes`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ deviceId, descripcion }),
  });
  return res.json();
}

export async function blockNode(deviceId) {
  const res = await fetch(`${API_URL}/nodes/${deviceId}/block`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  return res.json();
}

export async function unblockNode(deviceId) {
  const res = await fetch(`${API_URL}/nodes/${deviceId}/unblock`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  return res.json();
}

export async function deleteNode(deviceId) {
  const res = await fetch(`${API_URL}/nodes/${deviceId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return res.json();
}
