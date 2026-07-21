import { authHeaders } from './authHeaders';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export async function getEvents(filters = {}) {
  const query = new URLSearchParams(filters).toString();
  const res = await fetch(`${API_URL}/events${query ? `?${query}` : ''}`, {
    headers: authHeaders(),
  });
  return res.json();
}
