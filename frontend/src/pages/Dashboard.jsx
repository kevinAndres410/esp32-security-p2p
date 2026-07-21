import { useEffect, useState } from 'react';
import { subscribe } from '../services/socket.service';

export default function Dashboard({ usuario, onLogout }) {
  const [nodos, setNodos] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [alertas, setAlertas] = useState([]);

  useEffect(() => {
    const unsubEstado = subscribe('estado_red', (data) => {
      setNodos(data.nodos || []);
      setEventos(data.eventos || []);
    });
    const unsubAlerta = subscribe('alerta_nueva', (alerta) =>
      setAlertas((prev) => [alerta, ...prev].slice(0, 10))
    );
    return () => {
      unsubEstado();
      unsubAlerta();
    };
  }, []);

  const activos = nodos.filter((n) => n.estado === 'activo').length;

  const ultimaRotacion = eventos.find((ev) => ev.tipo === 'rotacion');
  const textoUltimaRotacion = ultimaRotacion
    ? tiempoRelativo(ultimaRotacion.creado_en)
    : 'Sin registros';

  const hoy = new Date().toDateString();
  const alertasHoy = eventos.filter(
    (ev) => (ev.tipo === 'alert' || ev.tipo === 'auth_failure') && new Date(ev.creado_en).toDateString() === hoy
  ).length;

  const huboFalloReciente = eventos.some((ev) => ev.tipo === 'auth_failure');

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.headerTitle}>🔒 ESP32 Security P2P</h2>
          {usuario && <p style={styles.headerSubtitle}>{usuario.nombre || usuario.email}</p>}
        </div>
        {onLogout && (
          <button style={styles.logoutBtn} onClick={onLogout}>Cerrar sesión</button>
        )}
      </div>

      {/* Tarjetas resumen */}
      <div style={styles.cards}>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Nodos activos</p>
          <p style={styles.cardValue}>{activos} / {nodos.length}</p>
        </div>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Última rotación</p>
          <p style={styles.cardValue}>{textoUltimaRotacion}</p>
        </div>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Alertas hoy</p>
          <p style={styles.cardValue}>{alertasHoy}</p>
        </div>
        <div style={styles.card}>
          <p style={styles.cardLabel}>Estado red</p>
          <p style={styles.cardValue}>{huboFalloReciente ? '🔴 Riesgo' : '🟢 Segura'}</p>
        </div>
      </div>

      <div style={styles.grid}>
        {/* Tabla de nodos */}
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Nodos en la red</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Device ID', 'Estado', 'Clave activa', 'Última actividad'].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodos.map((n) => (
                <tr key={n.device_id} style={styles.tr}>
                  <td style={styles.td}>{n.device_id}</td>
                  <td style={styles.td}>
                    <span style={{ color: n.estado === 'activo' ? '#4ade80' : '#f87171' }}>
                      {n.estado === 'activo' ? '🟢' : '🔴'} {n.estado}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <code>{n.clave_actual ? n.clave_actual.substring(0, 8) + '...' : '---'}</code>
                  </td>
                  <td style={styles.td}>
                    {n.ultima_actividad ? tiempoRelativo(n.ultima_actividad) : '-'}
                  </td>
                </tr>
              ))}
              {nodos.length === 0 && (
                <tr><td style={styles.td} colSpan={4}>No hay nodos registrados aún</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Alertas */}
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Alertas recientes</h3>
          {alertas.length === 0 && <p style={styles.alertaMsg}>Sin alertas por ahora</p>}
          {alertas.map((a, i) => (
            <div key={i} style={styles.alerta}>
              <span style={styles.alertaTipo}>{iconoTipo(a.tipo)}</span>
              <span style={styles.alertaMsg}>{a.mensaje}</span>
              <span style={styles.alertaHora}>{new Date(a.timestamp).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function iconoTipo(tipo) {
  if (tipo === 'auth_failure' || tipo === 'warning') return '⚠️ Alerta';
  if (tipo === 'rotacion') return '🔑 Clave';
  return '✅ Info';
}

function tiempoRelativo(fechaISO) {
  const diffMs = Date.now() - new Date(fechaISO).getTime();
  const minutos = Math.floor(diffMs / 60000);
  if (minutos < 1) return 'Hace instantes';
  if (minutos < 60) return `Hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Hace ${horas} h`;
  return `Hace ${Math.floor(horas / 24)} d`;
}

const styles = {
  container: { backgroundColor: '#0f172a', minHeight: '100vh', padding: '0', color: '#f8fafc', fontFamily: 'Arial, sans-serif' },
  header: { backgroundColor: '#1e293b', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155' },
  headerTitle: { color: '#f8fafc', margin: 0, fontSize: '20px' },
  headerSubtitle: { color: '#94a3b8', margin: '4px 0 0 0', fontSize: '13px' },
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
