import { authHeaders } from './authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export async function requestAdvancedAccess() {
  const response = await fetch(`${API_URL}/auth/access-request`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ motivo: 'Solicitud iniciada desde la Zona Técnica' }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo enviar la solicitud.');
  return data;
}
