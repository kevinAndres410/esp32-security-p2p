import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export default function Login({ onLogin, onRegister, message }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const email = localStorage.getItem('rememberedEmail');
    if (email) { setForm((current) => ({ ...current, email })); setRemember(true); }
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.email || !form.password) { setError('Por favor completa todos los campos.'); return; }
    if (remember) localStorage.setItem('rememberedEmail', form.email);
    else localStorage.removeItem('rememberedEmail');
    setLoading(true); setError('');
    try {
      const response = await axios.post(`${API_URL}/auth/login`, form);
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('usuario', JSON.stringify(response.data.usuario));
      onLogin(response.data.usuario);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Error al conectar con el servidor.');
    } finally { setLoading(false); }
  };

  return (
    <main className="login-page">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-logo" aria-hidden="true">S</div>
        <p className="eyebrow">ESP32 SECURITY P2P</p>
        <h1 id="login-title">Bienvenido de nuevo</h1>
        <p className="subtitle">Ingresa tus credenciales para acceder a tu panel seguro.</p>
        <form onSubmit={submit} className="login-form">
          {message && <p className="feedback success" role="status">{message}</p>}
          {error && <p className="feedback error" role="alert">{error}</p>}
          <label>Correo electrónico<input type="email" autoComplete="email" placeholder="nombre@ejemplo.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
          <label>Contraseña<input type="password" autoComplete="current-password" placeholder="••••••••" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
          <div className="login-options"><label className="remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Recordarme</label><a href="#recuperar">¿Olvidaste tu contraseña?</a></div>
          <button className="primary-button" disabled={loading}>{loading ? 'Ingresando…' : <>Iniciar sesión <span>→</span></>}</button>
        </form>
        <footer>¿Aún no tienes una cuenta? <button className="link-button" onClick={onRegister}>Crear una cuenta</button></footer>
      </section>
    </main>
  );
}
