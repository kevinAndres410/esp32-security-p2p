import { authHeaders } from './authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

async function call(path, options = {}) {
  const response = await fetch(`${API_URL}/master-admin${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || 'No se pudo completar la operación.');
  return body;
}

export const getWifiConfig = () => call('/wifi');
export const getWifiNetworks = () => call('/wifi/networks');
export const saveWifiConfig = (config) => call('/wifi', { method: 'PUT', body: JSON.stringify(config) });
export const testWifiConfig = (config) => call('/wifi/test', { method: 'POST', body: JSON.stringify(config) });
export const applyWifiConfig = () => call('/wifi/apply', { method: 'POST' });

export const getAdminKits = ({ query = '', status = 'all' } = {}) => {
  const params = new URLSearchParams({ q: query, status });
  return call(`/kits?${params}`);
};
export const createAdminKit = (kit) => call('/kits', { method: 'POST', body: JSON.stringify(kit) });
export const updateAdminKit = (id, kit) => call(`/kits/${id}`, { method: 'PATCH', body: JSON.stringify(kit) });
export const applyAdminKitWifi = (id) => call(`/kits/${id}/wifi/apply`, { method: 'POST' });
export const removeAdminKit = (id) => call(`/kits/${id}`, { method: 'DELETE' });
export const assignAdminKit = (id, ownerUserId) => call(`/kits/${id}/owner`, {
  method: 'PATCH', body: JSON.stringify({ ownerUserId }),
});
export const getAdminUsers = (query = '') => call(`/users?q=${encodeURIComponent(query)}`);
export const updateAdminUser = (id, change) => call(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(change) });
export const getAccessRequests = () => call('/access-requests');
export const decideAccessRequest = (id, decision, reason = '') => call(`/access-requests/${id}/decision`, {
  method: 'POST', body: JSON.stringify({ decision, reason }),
});
export const getAdminDeviceRequests = () => call('/device-requests');
export const getMonitoring = () => call('/monitoring');
export const getAdminAudit = () => call('/audit');
export const getAdminSettings = () => call('/settings');
export const updateAdminSettings = (rotationMinutes) => call('/settings', {
  method: 'PUT', body: JSON.stringify({ rotationMinutes }),
});
export const getAdminHealth = () => call('/health');

export async function downloadAdminBackup() {
  const response = await fetch(`${API_URL}/master-admin/backup`, { headers: authHeaders() });
  if (!response.ok) throw new Error('No se pudo descargar la copia de seguridad.');
  return response.blob();
}

export async function restoreAdminBackup(file) {
  const { 'Content-Type': _unused, ...headers } = authHeaders();
  const response = await fetch(`${API_URL}/master-admin/backup/restore`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'x-restore-confirmation': 'RESTAURAR' },
    body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo restaurar la copia.');
  return body;
}
