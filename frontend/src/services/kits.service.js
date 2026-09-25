import { authHeaders } from './authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
async function call(path, options = {}) {
  const response = await fetch(`${API_URL}/kits${path}`, { ...options, headers: authHeaders() });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación.');
  return body;
}
export const listKits = () => call('/');
export const claimKit = (claimCode) => call('/claim', { method: 'POST', body: JSON.stringify({ claimCode }) });
export const startScan = (kitId) => call(`/${kitId}/scans`, { method: 'POST' });
export const listCandidates = (kitId) => call(`/${kitId}/candidates`);
export const listInventory = (kitId) => call(`/${kitId}/inventory`);
export const requestDevice = (kitId, kitDeviceId, method = 'automatic') => call(`/${kitId}/requests`, {
  method: 'POST', body: JSON.stringify({ kitDeviceId, method }),
});
export const listDeviceRequests = () => call('/requests/all');
export const decideDevice = (id, action, reason = '') => call(`/requests/${id}/${action}`, {
  method: 'POST', body: JSON.stringify({ reason }),
});
