import React, { useState } from 'react';

function Login({ onLogin }) {
  const [form, setForm] = useState({ usuario: '', password: '' });
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleLogin = () => {
    if (!form.usuario || !form.password) {
      setError('Por favor completa todos los campos');
      return;
    }
    onLogin();
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>🔒 ESP32 Security P2P</h2>
        <p style={styles.subtitle}>Ingresa tus credenciales</p>

        {error && <p style={styles.error}>{error}</p>}

        <input
          style={styles.input}
          type="text"
          name="usuario"
          placeholder="Usuario"
          value={form.usuario}
          onChange={handleChange}
        />
        <input
          style={styles.input}
          type="password"
          name="password"
          placeholder="Contraseña"
          value={form.password}
          onChange={handleChange}
        />
        <button style={styles.button} onClick={handleLogin}>
          Iniciar sesión
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    height: '100vh', backgroundColor: '#0f172a'
  },
  card: {
    backgroundColor: '#1e293b', padding: '40px', borderRadius: '12px',
    width: '360px', boxShadow: '0 4px 24px rgba(0,0,0,0.4)'
  },
  title: { color: '#f8fafc', textAlign: 'center', marginBottom: '8px' },
  subtitle: { color: '#94a3b8', textAlign: 'center', marginBottom: '24px' },
  input: {
    width: '100%', padding: '12px', marginBottom: '16px',
    borderRadius: '8px', border: '1px solid #334155',
    backgroundColor: '#0f172a', color: '#f8fafc', fontSize: '14px',
    boxSizing: 'border-box'
  },
  button: {
    width: '100%', padding: '12px', backgroundColor: '#3b82f6',
    color: '#fff', border: 'none', borderRadius: '8px',
    fontSize: '15px', cursor: 'pointer', fontWeight: 'bold'
  },
  error: { color: '#f87171', textAlign: 'center', marginBottom: '12px' }
};

export default Login;