import React, { useState } from 'react';

function Dashboard({ onLogout }) {
  const [nodos] = useState([
    { id: 'Nodo A', estado: 'Conectado', clave: 'a3f1...', ultimaActividad: 'Hace 2 min' },
    { id: 'Nodo B', estado: 'Conectado', clave: 'b7c2...', ultimaActividad: 'Hace 5 min' },
    { id: 'Nodo C', estado: 'Desconectado', clave: '---', ultimaActividad: 'Hace 1 hora' },
  ]);

  const [alertas] = useState([
    { tipo: '⚠️ Alerta', mensaje: 'Intento de conexión no autorizado detectado', hora: '07:21' },
    { tipo: '✅ Info', mensaje: 'Rotación de claves completada exitosamente', hora: '07:15' },
    { tipo: '✅ Info', mensaje: 'Nodo A registrado en la red', hora: '07:10' },
  ]);

  return (
    <div style={styles.container}>

      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.headerTitle}>🔒 ESP32 Security P2P</h2>
        <button style={styles.logoutBtn} onClick={onLogout}>Cerrar sesión</button>
      </div>

      {/* Tarjetas resumen */}
      <div style={styles.cards}>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Nodos activos</p>
          <p style={styles.cardValue}>2 / 3</p>
        </div>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Última rotación</p>
          <p style={styles.cardValue}>Hace 6 min</p>
        </div>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Alertas hoy</p>
          <p style={styles.cardValue}>1</p>
        </div>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Estado red</p>
          <p style={styles.cardValue}>🟢 Segura</p>
        </div>
      </div>

      <div style={styles.grid}>

        {/* Tabla de nodos */}
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Nodos en la red</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                {['ID', 'Estado', 'Clave activa', 'Última actividad'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodos.map((n, i) => (
                <tr key={i} style={styles.tr}>
                  <td style={styles.td}>{n.id}</td>
                  <td style={styles.td}>
                    <span style={{ color: n.estado === 'Conectado' ? '#4ade80' : '#f87171' }}>
                      {n.estado === 'Conectado' ? '🟢' : '🔴'} {n.estado}
                    </span>
                  </td>
                  <td style={styles.td}><code>{n.clave}</code></td>
                  <td style={styles.td}>{n.ultimaActividad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Alertas */}
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Alertas recientes</h3>
          {alertas.map((a, i) => (
            <div key={i} style={styles.alerta}>
              <span style={styles.alertaTipo}>{a.tipo}</span>
              <span style={styles.alertaMsg}>{a.mensaje}</span>
              <span style={styles.alertaHora}>{a.hora}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#0f172a', minHeight: '100vh', padding: '0', color: '#f8fafc', fontFamily: 'Arial, sans-serif' },
  header: { backgroundColor: '#1e293b', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155' },
  headerTitle: { color: '#f8fafc', margin: 0, fontSize: '20px' },
  logoutBtn: { backgroundColor: '#ef4444', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' },
  cards: { display: 'flex', gap: '16px', padding: '24px 32px' },
  card: { flex: 1, backgroundColor: '#1e293b', borderRadius: '12px', padding: '20px', textAlign: 'center', border: '1px solid #334155' },
  cardLabel: { color: '#94a3b8', fontSize: '13px', margin: '0 0 8px 0' },
  cardValue: { color: '#f8fafc', fontSize: '24px', fontWeight: 'bold', margin: 0 },
  grid: { display: 'flex', gap: '16px', padding: '0 32px 32px 32px' },
  panel: { flex: 1, backgroundColor: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155' },
  panelTitle: { color: '#94a3b8', fontSize: '14px', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '1px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { color: '#94a3b8', fontSize: '13px', padding: '10px', textAlign: 'left', borderBottom: '1px solid #334155' },
  tr: { borderBottom: '1px solid #1e293b' },
  td: { color: '#f8fafc', fontSize: '14px', padding: '12px 10px' },
  alerta: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid #334155' },
  alertaTipo: { fontSize: '12px', minWidth: '80px' },
  alertaMsg: { color: '#cbd5e1', fontSize: '13px', flex: 1 },
  alertaHora: { color: '#64748b', fontSize: '12px' },
};

export default Dashboard;