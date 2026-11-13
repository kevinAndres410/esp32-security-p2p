import { useCallback, useEffect, useMemo, useState } from 'react';
import { decideDevice } from '../services/kits.service';
import {
  assignAdminKit, decideAccessRequest, downloadAdminBackup, getAccessRequests,
  getAdminAudit, getAdminDeviceRequests, getAdminHealth, getAdminSettings,
  getAdminUsers, getMonitoring, restoreAdminBackup, updateAdminSettings,
  updateAdminUser,
} from '../services/masterAdmin.service';

function Panel({ title, eyebrow, children, action }) {
  return <section className="ma-panel ma-ops-panel"><header className="ma-ops-heading"><div><p>{eyebrow}</p><h2>{title}</h2></div>{action}</header>{children}</section>;
}

function LoadState({ error, loading }) {
  return error ? <p className="ma-ops-error" role="alert">{error}</p> : loading ? <p className="ma-ops-muted">Cargando datos…</p> : null;
}

export default function MasterAdminOperations({ section, usuario, kits, notify, onKitsChanged, onRestored }) {
  if (section === 'users') return <Users usuario={usuario} notify={notify} />;
  if (section === 'access') return <AccessRequests notify={notify} />;
  if (section === 'devices') return <DeviceRequests notify={notify} />;
  if (section === 'assignments') return <Assignments kits={kits} notify={notify} onKitsChanged={onKitsChanged} />;
  if (section === 'monitoring') return <Monitoring />;
  if (section === 'audit') return <Audit />;
  if (section === 'maintenance') return <Maintenance notify={notify} onRestored={onRestored} />;
  return null;
}

function Users({ usuario, notify }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const refresh = useCallback(async () => {
    try { setUsers(await getAdminUsers()); setError(''); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const visible = useMemo(() => users.filter((item) =>
    `${item.id} ${item.nombre} ${item.email}`.toLowerCase().includes(query.toLowerCase())), [users, query]);
  const change = async (item, update) => {
    const label = update.blocked === true ? 'bloquear' : update.role ? `asignar el rol ${update.role} a` : null;
    if (label && !window.confirm(`¿Confirmas ${label} ${item.email}? Se cerrarán sus sesiones actuales.`)) return;
    setBusy(item.id);
    try { await updateAdminUser(item.id, update); await refresh(); notify('success', 'Usuario actualizado. Sus sesiones anteriores fueron revocadas.'); }
    catch (operationError) { notify('error', operationError.message); }
    finally { setBusy(null); }
  };
  return <Panel eyebrow="GESTIÓN DE ACCESO" title="Usuarios y roles" action={<span className="ma-ops-count">{users.length} cuentas</span>}>
    <LoadState error={error} loading={loading} />
    <input className="ma-ops-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, correo o ID…" aria-label="Buscar usuarios" />
    <div className="ma-table-wrap"><table className="ma-ops-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Kits</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td><b>{item.nombre}</b><small>{item.email}</small></td><td>{item.rol === 'master_admin' ? <strong>Administrador Maestro</strong> : <select aria-label={`Rol de ${item.nombre}`} value={item.rol} disabled={busy === item.id} onChange={(event) => change(item, { role: event.target.value })}><option value="basico">Básico</option><option value="avanzado">Avanzado</option></select>}</td><td>{item.kit_count}</td><td><span className={`ma-ops-pill ${item.bloqueado ? 'danger' : 'success'}`}>{item.bloqueado ? 'Bloqueado' : 'Activo'}</span></td><td><button className="ma-secondary ma-small" disabled={busy === item.id || item.rol === 'master_admin'} onClick={() => change(item, { blocked: !item.bloqueado })}>{item.bloqueado ? 'Desbloquear' : 'Bloquear'}</button></td></tr>)}</tbody></table>{!visible.length && !loading && <p className="ma-ops-empty">No se encontraron usuarios.</p>}</div>
  </Panel>;
}

function AccessRequests({ notify }) {
  const [rows, setRows] = useState([]);
  const [reasons, setReasons] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => getAccessRequests().then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const decide = async (row, decision) => {
    setBusy(row.id);
    try { await decideAccessRequest(row.id, decision, reasons[row.id] || ''); await load(); notify('success', `Solicitud ${decision === 'approved' ? 'aprobada' : 'rechazada'}.`); }
    catch (e) { notify('error', e.message); }
    finally { setBusy(null); }
  };
  return <Panel eyebrow="SOLICITUDES DE PERMISOS" title="Acceso avanzado" action={<span className="ma-ops-count">{rows.filter((row) => row.status === 'pending').length} pendientes</span>}><LoadState error={error} /><div className="ma-ops-list">{rows.map((row) => <article className="ma-ops-request" key={row.id}><div><b>{row.userName}</b><small>{row.email} · {new Date(row.requestedAt).toLocaleString()}</small><p>{row.reason || 'Sin motivo indicado'}</p></div><div className="ma-ops-decision">{row.status === 'pending' ? <><input value={reasons[row.id] || ''} onChange={(event) => setReasons({ ...reasons, [row.id]: event.target.value })} placeholder="Motivo si se rechaza" aria-label={`Motivo de rechazo de ${row.userName}`} /><button className="ma-secondary ma-small" disabled={busy === row.id} onClick={() => decide(row, 'rejected')}>Rechazar</button><button className="ma-primary ma-small" disabled={busy === row.id} onClick={() => decide(row, 'approved')}>Aprobar</button></> : <span className={`ma-ops-pill ${row.status === 'approved' ? 'success' : 'danger'}`}>{row.status === 'approved' ? 'Aprobada' : 'Rechazada'}</span>}</div></article>)}{!rows.length && !error && <p className="ma-ops-empty">No hay solicitudes de acceso.</p>}</div></Panel>;
}

function DeviceRequests({ notify }) {
  const [rows, setRows] = useState([]);
  const [reasons, setReasons] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => getAdminDeviceRequests().then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const decide = async (row, action) => {
    if (action === 'approve' && !window.confirm(`¿Aprobar ${row.device_id} para el ${row.gateway_id}?`)) return;
    setBusy(row.id);
    try { await decideDevice(row.id, action, reasons[row.id] || ''); await load(); notify('success', `Dispositivo ${action === 'approve' ? 'aprobado' : 'rechazado'}.`); }
    catch (e) { notify('error', e.message); }
    finally { setBusy(null); }
  };
  return <Panel eyebrow="INCORPORACIÓN IOT" title="Solicitudes de dispositivos" action={<span className="ma-ops-count">{rows.filter((row) => row.status === 'pending').length} pendientes</span>}><LoadState error={error} /><div className="ma-ops-list">{rows.map((row) => <article className="ma-ops-request" key={row.id}><div><b>{row.device_id}</b><small>{row.gateway_id} · Kit {row.kit_id} · {row.requester_name}</small><p>{row.method === 'manual' ? 'Registro manual' : 'Detectado por el Gateway'} · {row.mac_address}</p></div><div className="ma-ops-decision">{row.status === 'pending' ? <><input value={reasons[row.id] || ''} onChange={(event) => setReasons({ ...reasons, [row.id]: event.target.value })} placeholder="Motivo si se rechaza" aria-label={`Motivo de rechazo de ${row.device_id}`} /><button className="ma-secondary ma-small" disabled={busy === row.id} onClick={() => decide(row, 'reject')}>Rechazar</button><button className="ma-primary ma-small" disabled={busy === row.id} onClick={() => decide(row, 'approve')}>Aprobar</button></> : <span className={`ma-ops-pill ${row.status === 'approved' ? 'success' : 'danger'}`}>{row.status}</span>}</div></article>)}{!rows.length && !error && <p className="ma-ops-empty">No hay solicitudes de dispositivos.</p>}</div></Panel>;
}

function Assignments({ kits, notify, onKitsChanged }) {
  const [users, setUsers] = useState([]);
  const [selection, setSelection] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { getAdminUsers().then(setUsers).catch((e) => setError(e.message)); }, []);
  const assign = async (kit) => {
    const selected = selection[kit.id] === undefined ? (kit.ownerUserId || '') : selection[kit.id];
    const ownerUserId = selected ? Number(selected) : null;
    if (ownerUserId === (kit.ownerUserId || null)) return;
    if (!window.confirm(`¿Cambiar el propietario de ${kit.name}? Las aprobaciones anteriores se revocarán.`)) return;
    setBusy(kit.id);
    try { await assignAdminKit(kit.id, ownerUserId); await onKitsChanged(); notify('success', `${kit.name} asignado correctamente.`); }
    catch (e) { notify('error', e.message); }
    finally { setBusy(null); }
  };
  return <Panel eyebrow="PROPIEDAD DEL INVENTARIO" title="Asignación de kits"><LoadState error={error} /><p className="ma-ops-muted">Al transferir un kit se revocan las aprobaciones anteriores; el nuevo propietario debe solicitar la admisión de sus nodos.</p><div className="ma-ops-list">{kits.map((kit) => <article className="ma-ops-request" key={kit.id}><div><b>{kit.name}</b><small>{kit.gatewayIdentifier} · {kit.components.length} nodos</small></div><div className="ma-ops-decision"><select value={selection[kit.id] === undefined ? (kit.ownerUserId || '') : selection[kit.id]} onChange={(event) => setSelection({ ...selection, [kit.id]: event.target.value })} aria-label={`Propietario de ${kit.name}`}><option value="">Sin asignar</option>{users.filter((user) => !user.bloqueado).map((user) => <option key={user.id} value={user.id}>{user.nombre} · {user.email}</option>)}</select><button className="ma-primary ma-small" disabled={busy === kit.id} onClick={() => assign(kit)}>Guardar</button></div></article>)}{!kits.length && <p className="ma-ops-empty">No hay kits registrados.</p>}</div></Panel>;
}

function Monitoring() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => getMonitoring().then((value) => live && setData(value)).catch((e) => live && setError(e.message));
    load(); const timer = setInterval(load, 15000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  return <><Panel eyebrow="ESTADO DEL SISTEMA" title="Monitoreo en vivo"><LoadState error={error} loading={!data && !error} />{data && <><div className="ma-ops-metrics">{[['Usuarios', data.counts.users], ['Kits', data.counts.kits], ['Nodos en línea', data.counts.nodesOnline], ['Nodos desconectados', data.counts.nodesOffline], ['Accesos pendientes', data.counts.pendingAccess], ['Dispositivos pendientes', data.counts.pendingDevices]].map(([label, number]) => <div key={label}><small>{label}</small><strong>{number}</strong></div>)}</div><small className="ma-ops-muted">Actualizado: {new Date(data.checkedAt).toLocaleString()} · cada 15 segundos</small></>}</Panel>{data && <Panel eyebrow="TELEMETRÍA RECIENTE" title="Nodos y rendimiento"><div className="ma-table-wrap"><table className="ma-ops-table"><thead><tr><th>Nodo</th><th>Kit / Gateway</th><th>Última actividad</th><th>RTT</th><th>Memoria libre</th><th>CPU</th></tr></thead><tbody>{data.nodes.map((node) => <tr key={node.device_id}><td><b>{node.device_id}</b></td><td>{node.kit_id ? `Kit ${node.kit_id} · ${node.gateway_id}` : 'Sin kit'}</td><td>{node.ultima_actividad || 'Sin datos'}</td><td>{node.rtt_ms == null ? '—' : `${node.rtt_ms} ms`}</td><td>{node.heap_libre_bytes == null ? '—' : `${Math.round(node.heap_libre_bytes / 1024)} KB`}</td><td>{node.cpu_porcentaje == null ? '—' : `${node.cpu_porcentaje}%`}</td></tr>)}</tbody></table>{!data.nodes.length && <p className="ma-ops-empty">No hay nodos operativos.</p>}</div></Panel>}{data && <Panel eyebrow="SEGURIDAD Y ACTIVIDAD" title="Eventos recientes"><div className="ma-ops-list">{data.recentEvents.map((event) => <div className="ma-ops-event" key={event.id}><span>{event.tipo}</span><b>{event.mensaje}</b><small>{event.creado_en}</small></div>)}{!data.recentEvents.length && <p className="ma-ops-empty">No hay eventos.</p>}</div></Panel>}</>;
}

function Audit() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { getAdminAudit().then(setRows).catch((e) => setError(e.message)); }, []);
  const visible = useMemo(() => rows.filter((row) =>
    `${row.action} ${row.entity_type} ${row.entity_id} ${row.actor_name} ${row.actor_email}`.toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const exportCsv = () => {
    const columns = ['Fecha', 'Actor', 'Correo', 'Acción', 'Entidad', 'ID', 'Detalle'];
    const quote = (value) => {
      const raw = String(value ?? '');
      const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [columns, ...visible.map((row) => [row.created_at, row.actor_name, row.actor_email, row.action, row.entity_type, row.entity_id, JSON.stringify(row.metadata)])];
    const blob = new Blob([lines.map((line) => line.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'securemesh-auditoria.csv'; link.click();
    URL.revokeObjectURL(url);
  };
  return <Panel eyebrow="TRAZABILIDAD" title="Auditoría administrativa" action={<button className="ma-secondary ma-small" onClick={exportCsv} disabled={!visible.length}>Exportar CSV</button>}><LoadState error={error} /><input className="ma-ops-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar por acción, actor o entidad…" aria-label="Filtrar auditoría" /><div className="ma-table-wrap"><table className="ma-ops-table"><thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td>{row.created_at}</td><td><b>{row.actor_name || 'Usuario eliminado'}</b><small>{row.actor_email}</small></td><td><code>{row.action}</code></td><td>{row.entity_type} #{row.entity_id}</td><td><code>{JSON.stringify(row.metadata)}</code></td></tr>)}</tbody></table>{!visible.length && !error && <p className="ma-ops-empty">No hay registros para este filtro.</p>}</div></Panel>;
}

function Maintenance({ notify, onRestored }) {
  const [settings, setSettings] = useState(null);
  const [health, setHealth] = useState(null);
  const [file, setFile] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([getAdminSettings(), getAdminHealth()])
      .then(([configured, currentHealth]) => { setSettings(configured); setHealth(currentHealth); })
      .catch((e) => setError(e.message));
  }, []);
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try { const value = await updateAdminSettings(Number(settings.rotationMinutes)); setSettings({ ...settings, ...value }); notify('success', 'Intervalo aplicado y guardado.'); }
    catch (e) { notify('error', e.message); }
    finally { setBusy(false); }
  };
  const backup = async () => {
    setBusy(true);
    try {
      const blob = await downloadAdminBackup(); const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `securemesh-backup-${new Date().toISOString().slice(0, 10)}.sqlite`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      notify('success', 'Copia descargada. Guárdala en un lugar protegido.');
    } catch (e) { notify('error', e.message); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!file || confirmation !== 'RESTAURAR') return;
    setBusy(true);
    try { await restoreAdminBackup(file); onRestored(); }
    catch (e) { notify('error', e.message); setBusy(false); }
  };
  return <><Panel eyebrow="SALUD DEL SERVICIO" title="Operación y mantenimiento"><LoadState error={error} loading={!health && !error} />{health && <div className="ma-ops-metrics">{[['Backend', health.backend], ['Base de datos', health.database], ['Adaptador Gateway', health.gatewayAdapter], ['Tiempo activo', `${health.uptimeSeconds} s`]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>}</Panel>{settings && <Panel eyebrow="SEGURIDAD IOT" title="Rotación automática de claves"><form className="ma-ops-setting" onSubmit={save}><label>Intervalo en minutos<input type="number" min="1" max="1440" required value={settings.rotationMinutes} onChange={(event) => setSettings({ ...settings, rotationMinutes: event.target.value })} /></label><button className="ma-primary ma-small" disabled={busy}>Aplicar intervalo</button></form><p className="ma-ops-muted">El cambio se guarda en la base de datos y se aplica sin reiniciar el servidor.</p></Panel>}<Panel eyebrow="COPIAS DE SEGURIDAD" title="Respaldo y restauración"><p className="ma-ops-muted">La copia contiene cuentas, kits, eventos y claves de dispositivos. Descárgala únicamente en un equipo protegido.</p><button className="ma-secondary ma-small" disabled={busy} onClick={backup}>Descargar copia SQLite</button><div className="ma-ops-restore"><h3>Restaurar una copia</h3><p>La restauración reemplaza los datos actuales y cierra todas las sesiones. Solo se admite una copia íntegra con el mismo esquema y la misma clave maestra.</p><input type="file" accept=".sqlite,.db,application/octet-stream" onChange={(event) => setFile(event.target.files?.[0] || null)} aria-label="Archivo de copia de seguridad" /><label>Escribe RESTAURAR para confirmar<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="ma-danger-button ma-small" disabled={busy || !file || confirmation !== 'RESTAURAR'} onClick={restore}>Restaurar copia</button></div></Panel></>;
}
