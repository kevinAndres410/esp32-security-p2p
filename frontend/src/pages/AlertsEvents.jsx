import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEvents } from '../services/events.service';
import { subscribe } from '../services/socket.service';
import { CardHeader, Empty, Page } from './Dashboard';

const types = [['', 'Todos'], ['conexion', 'Conexión'], ['bloqueo', 'Bloqueo'], ['eliminacion', 'Eliminación'], ['rotacion', 'Rotación de claves'], ['auth_failure', 'Fallo de autenticación']];
const typeLabel = (type) => types.find(([value]) => value === type)?.[1] || type || 'Sistema';

export default function AlertsEvents() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setEvents(await getEvents()); setError(''); } catch { setError('No fue posible cargar los eventos.'); } }, []);
  useEffect(() => { load(); return subscribe('alerta_nueva', load); }, [load]);
  const visible = useMemo(() => filter ? events.filter((event) => event.tipo === filter) : events, [events, filter]);

  return <Page><header className="page-heading"><div><p className="eyebrow">MONITOREO DE SEGURIDAD</p><h1>Alertas y eventos</h1><p>Consulta el historial de actividad y los eventos de seguridad de la red.</p></div></header>
    <section className="card filters"><label htmlFor="event-filter">Filtrar por:<select id="event-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span className="live-pill"><i /> {visible.length} registros</span></section>{error && <p className="feedback error">{error}</p>}
    <section className="card table-card spaced"><CardHeader eyebrow="REGISTRO DE ACTIVIDAD" title="Eventos recientes" /><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Nodo</th><th>Tipo</th><th>Mensaje</th></tr></thead><tbody>{visible.map((event) => <tr key={event.id}><td>{formatDate(event.creado_en)}</td><td><span className="device-mark">⌁</span>{event.nodo_id || '-'}</td><td><span className={`event-badge ${event.tipo}`}>{typeLabel(event.tipo)}</span></td><td>{event.mensaje || 'Sin descripción disponible'}</td></tr>)}{!visible.length && <Empty colSpan="4" text="No hay eventos para el filtro seleccionado." />}</tbody></table></div></section>
  </Page>;
}

const formatDate = (date) => date ? new Date(date).toLocaleString('sv-SE').replace('T', ' ') : '-';
