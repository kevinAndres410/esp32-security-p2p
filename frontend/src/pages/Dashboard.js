import { useEffect, useMemo, useState } from 'react';
import { subscribe } from '../services/socket.service';

export default function Dashboard({ usuario, onNavigate, isAdvanced }) {
  const [nodos, setNodos] = useState([]);
  const [gateway, setGateway] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [alertas, setAlertas] = useState([]);

  useEffect(() => {
    const stopNetwork = subscribe('estado_red', (data) => {
      setNodos(data.nodos || []);
      setGateway(data.gateway || null);
      setEventos(data.eventos || []);
    });
    const stopAlerts = subscribe('alerta_nueva', (alerta) => setAlertas((current) => [alerta, ...current].slice(0, 5)));
    return () => { stopNetwork(); stopAlerts(); };
  }, []);

  const activos = nodos.filter((node) => node.estado === 'activo').length;
  const ultimaRotacion = eventos.find((event) => event.tipo === 'rotacion');
  const alertasHoy = useMemo(() => eventos.filter((event) => ['alert', 'auth_failure'].includes(event.tipo) && isToday(event.creado_en)).length, [eventos]);
  const uptime = nodos.length ? ((activos / nodos.length) * 100).toFixed(1) : '0.0';

  return <Page><header className="page-heading"><div><p className="eyebrow">CENTRO DE CONTROL</p><h1>Visión general de la red</h1><p>Hola, {usuario?.nombre || usuario?.email}. Estado operativo en tiempo real.</p></div><span className="live-pill"><i /> Sistema operativo</span></header>
    <section className="metrics-grid">
      <Metric icon="⇄" title="Gateway" value={gateway?.estado === 'activo' ? 'Activo' : 'Desconectado'} detail={gateway?.mac_address || 'Sin sincronización'} />
      <Metric icon="◉" title="Nodos activos" value={<>{activos} <small>/ {nodos.length}</small></>} detail="Conexión estable" />
      <Metric icon="↻" title="Última rotación" value={ultimaRotacion ? relativeTime(ultimaRotacion.creado_en) : 'Sin registros'} detail={ultimaRotacion ? formatTime(ultimaRotacion.creado_en) : 'Esperando sincronización'} />
      <Metric icon="△" title="Alertas hoy" value={<>{alertasHoy} <small>alertas</small></>} detail="Monitoreo activo" />
      <article className="card metric-card"><div className="metric-label"><span>⌁</span>Estado de red</div><div className="network-value"><strong>Óptimo</strong><small>{uptime}% uptime</small></div><div className="progress"><i style={{ width: `${uptime}%` }} /></div></article>
    </section>
    {!isAdvanced && <section className="guided-card card"><div className="rotation-icon">✓</div><div><p className="eyebrow">MODO GUIADO</p><h2>Protección automática activada</h2><p>Las claves y los parámetros técnicos se administran de forma segura en segundo plano.</p></div></section>}
    <section className="dashboard-grid"><article className="card table-card"><CardHeader eyebrow="DISPOSITIVOS" title="Nodos en la red" action={isAdvanced ? 'Administrar' : 'Mis dispositivos'} onAction={() => onNavigate(isAdvanced ? 'dispositivos' : 'kit')} /><div className="table-scroll"><table><thead><tr><th>Nodo</th><th>Identificador</th><th>Actividad</th><th>Estado</th></tr></thead><tbody>{nodos.slice(0, 5).map((node) => <tr key={node.device_id}><td><span className="device-mark">⌁</span><b>{node.descripcion || 'Nodo ESP32'}</b></td><td><code>{node.device_id}</code></td><td>{node.ultima_actividad ? relativeTime(node.ultima_actividad) : '-'}</td><td><Status status={node.estado} /></td></tr>)}{!nodos.length && <Empty colSpan="4" text="Aún no hay nodos registrados." />}</tbody></table></div></article>
      <aside className="card activity-card"><CardHeader eyebrow="EVENTOS" title="Actividad reciente" action="Ver logs" onAction={() => onNavigate('alertas')} /><div className="activity-list">{alertas.slice(0, 4).map((alert, index) => <div className="activity-item" key={alert.id || index}><span>{alert.tipo === 'auth_failure' ? '!' : '✓'}</span><div><b>{alert.mensaje}</b><small>{formatTime(alert.timestamp)}</small></div></div>)}{!alertas.length && <p className="empty-copy">Sin alertas recientes.</p>}</div></aside>
    </section>
  </Page>;
}

export const Page = ({ children }) => <main className="page"><div className="content">{children}</div></main>;
export const CardHeader = ({ eyebrow, title, action, onAction }) => <header className="card-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{action && <button className="ghost-button" onClick={onAction}>{action} →</button>}</header>;
export const Status = ({ status, active }) => {
  const value = status || (active ? 'activo' : 'inactivo');
  const labels = { activo: 'Activo', desconectado: 'Desconectado', pendiente: 'Pendiente', bloqueado: 'Bloqueado', inactivo: 'Inactivo' };
  return <span className={`status ${value} ${value === 'activo' ? 'active' : ''}`}><i />{labels[value] || 'Desconocido'}</span>;
};
export const Empty = ({ colSpan, text }) => <tr><td className="empty-cell" colSpan={colSpan}>{text}</td></tr>;
const Metric = ({ icon, title, value, detail }) => <article className="card metric-card"><div className="metric-label"><span>{icon}</span>{title}</div><strong className="metric-value">{value}</strong><small className="metric-detail">{detail}</small></article>;
export const relativeTime = (date) => { const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000)); return mins < 1 ? 'Hace instantes' : mins < 60 ? `Hace ${mins} min` : `Hace ${Math.floor(mins / 60)} h`; };
export const formatTime = (date) => date ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
const isToday = (date) => new Date(date).toDateString() === new Date().toDateString();
