import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyAdminKitWifi,
  createAdminKit,
  getAdminKits,
  getWifiConfig,
  getWifiNetworks,
  removeAdminKit,
  saveWifiConfig,
  testWifiConfig,
  updateAdminKit,
} from '../services/masterAdmin.service';
import './MasterAdmin.css';
import MasterAdminOperations from './MasterAdminOperations';
import { applyWifiConfig } from '../services/masterAdmin.service';

const EMPTY_KIT = { gatewayIdentifier: '', nodeIdentifiers: ['', '', ''], wifiNetworkId: '', notes: '' };

function Icon({ name }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    wifi: <><path d="M5 12.6a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20h.01"/></>,
    kit: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></>,
    edit: <><path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20l-5 1 1-5L16.5 3.5Z"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  };
  return <svg className="ma-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function StatusBadge({ status }) {
  const labels = { connected: 'Conectado', saved: 'Guardada', test_ok: 'Prueba exitosa', disconnected: 'Desconectado', error: 'Error de red', unavailable: 'Sin adaptador', online: 'En línea', active: 'Activo', inactive: 'Inactivo' };
  return <span className={`ma-status ma-status--${status}`}><i />{labels[status] || status}</span>;
}

export default function MasterAdmin({ usuario, onRestored }) {
  const [section, setSection] = useState('kits');
  const [kits, setKits] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [kitModal, setKitModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [wifi, setWifi] = useState({ ssid: '', password: '', securityType: 'WPA2', connectionStatus: 'disconnected', passwordConfigured: false });
  const [wifiNetworks, setWifiNetworks] = useState([]);
  const [wifiDirty, setWifiDirty] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const loadKits = useCallback(async () => {
    const result = await getAdminKits();
    setKits(result);
  }, []);

  useEffect(() => {
    loadKits().catch((error) => setNotice({ type: 'error', text: error.message }));
  }, [loadKits]);

  useEffect(() => {
    getWifiConfig().then((result) => { setWifi((current) => ({ ...current, ...result, password: '' })); setWifiDirty(false); })
      .catch((error) => setNotice({ type: 'error', text: error.message }));
    getWifiNetworks().then(setWifiNetworks)
      .catch((error) => setNotice({ type: 'error', text: error.message }));
  }, []);

  const metrics = useMemo(() => ({
    total: kits.length,
    online: kits.filter((kit) => kit.status === 'online').length,
    active: kits.filter((kit) => ['active', 'online'].includes(kit.status)).length,
  }), [kits]);
  const visibleKits = useMemo(() => kits.filter((kit) => {
    if (filter !== 'all' && kit.status !== filter) return false;
    const searchable = [kit.id, kit.name, kit.uniqueKey, kit.gatewayIdentifier, kit.wifiSsid,
      ...kit.components.map((component) => component.identifier)].join(' ').toLowerCase();
    return searchable.includes(query.trim().toLowerCase());
  }), [kits, query, filter]);

  const run = async (operation, success) => {
    setBusy(true); setNotice(null);
    try {
      const result = await operation();
      if (success) setNotice({ type: 'success', text: success });
      return result;
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
      throw error;
    } finally { setBusy(false); }
  };

  const saveWifi = async (event) => {
    event.preventDefault();
    try {
      await run(() => saveWifiConfig(wifi), 'Configuración Wi-Fi guardada y cifrada.');
      setWifiNetworks(await getWifiNetworks());
      await loadKits();
      setWifi((current) => ({ ...current, password: '', passwordConfigured: current.securityType !== 'OPEN', connectionStatus: 'saved' }));
      setWifiDirty(false);
    } catch { /* El aviso global contiene el error. */ }
  };

  const testWifi = async () => {
    try {
      const result = await run(() => testWifiConfig(wifi), null);
      setWifi((current) => ({ ...current, connectionStatus: result.ok ? 'test_ok' : result.status, lastError: result.ok ? null : result.message }));
      setNotice({ type: result.ok ? 'success' : 'error', text: result.message });
    } catch { /* El adaptador no disponible se presenta como aviso. */ }
  };

  const applyWifi = async () => {
    try {
      const result = await run(() => applyWifiConfig(), null);
      setWifi((current) => ({ ...current, connectionStatus: result.status, lastError: result.ok ? null : result.message }));
      setNotice({ type: result.ok ? 'success' : 'error', text: result.message });
    } catch { /* El aviso global contiene el error. */ }
  };

  const submitKit = async (form) => {
    try {
      if (form.id) {
        await run(() => updateAdminKit(form.id, {
          status: form.status === 'online' ? 'active' : form.status,
          notes: form.notes,
          wifiNetworkId: Number(form.wifiNetworkId),
          gatewayIdentifier: form.gatewayIdentifier,
          nodeIdentifiers: form.nodeIdentifiers,
        }), `${form.name} actualizado.`);
      } else {
        const created = await run(() => createAdminKit(form), null);
        setNotice({ type: 'success', text: `${created.name} creado con la red ${created.wifiSsid}. Usa el icono Wi-Fi para aplicarla al Gateway y «Copiar clave» para entregarla al propietario.` });
      }
      setKitModal(null);
      await loadKits();
    } catch { /* El modal permanece abierto para corregir. */ }
  };

  const deleteKit = async () => {
    try {
      await run(() => removeAdminKit(deleteTarget.id), `${deleteTarget.name} eliminado y sus dispositivos desvinculados.`);
      setDeleteTarget(null);
      await loadKits();
    } catch { /* El modal permanece visible. */ }
  };

  const copyKey = async (kit) => {
    if (!kit.uniqueKey) return setNotice({ type: 'error', text: 'Este kit legado no dispone de una clave recuperable.' });
    try {
      await navigator.clipboard.writeText(kit.uniqueKey);
      setNotice({ type: 'success', text: `Clave de ${kit.name} copiada al portapapeles.` });
    } catch { setNotice({ type: 'error', text: 'El navegador no permitió copiar la clave.' }); }
  };

  const openKitEditor = (kit) => {
    setKitModal({
      ...kit,
      nodeIdentifiers: [1, 2, 3].map((index) =>
        kit.components.find((component) => component.component_role === `node_${index}`)?.identifier || ''),
    });
  };

  const applyKitNetwork = async (kit) => {
    try {
      const result = await run(() => applyAdminKitWifi(kit.id), null);
      setNotice({ type: result.ok ? 'success' : 'error', text: result.message });
    } catch { /* El aviso global contiene el error. */ }
  };

  return <main className="master-admin">
    <aside className="ma-sidebar">
      <div className="ma-sidebar__brand"><span><Icon name="shield" /></span><div><b>Master Admin</b><small>SecureMesh Console</small></div></div>
      <nav aria-label="Secciones de Administrador Maestro">
        <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><Icon name="grid" />Resumen</button>
        <button className={section === 'wifi' ? 'active' : ''} onClick={() => setSection('wifi')}><Icon name="wifi" />Red Wi-Fi</button>
        <button className={section === 'kits' ? 'active' : ''} onClick={() => setSection('kits')}><Icon name="kit" />Kits registrados</button>
        <button className={section === 'assignments' ? 'active' : ''} onClick={() => setSection('assignments')}><Icon name="kit" />Asignación de kits</button>
        <button className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}><Icon name="shield" />Usuarios y roles</button>
        <button className={section === 'access' ? 'active' : ''} onClick={() => setSection('access')}><Icon name="shield" />Solicitudes de acceso</button>
        <button className={section === 'devices' ? 'active' : ''} onClick={() => setSection('devices')}><Icon name="grid" />Aprobar dispositivos</button>
        <button className={section === 'monitoring' ? 'active' : ''} onClick={() => setSection('monitoring')}><Icon name="wifi" />Monitoreo</button>
        <button className={section === 'audit' ? 'active' : ''} onClick={() => setSection('audit')}><Icon name="search" />Auditoría</button>
        <button className={section === 'maintenance' ? 'active' : ''} onClick={() => setSection('maintenance')}><Icon name="shield" />Mantenimiento</button>
      </nav>
      <div className="ma-admin-card"><span>{(usuario?.nombre || 'A').slice(0, 1).toUpperCase()}</span><div><b>{usuario?.nombre || 'Administrador'}</b><small>Administrador Maestro</small></div></div>
    </aside>

    <section className="ma-workspace">
      <header className="ma-header"><div><p>GESTIÓN DEL APLICATIVO</p><h1>{({ overview: 'Resumen del sistema', wifi: 'Configuración de red', kits: 'Administración de kits', assignments: 'Asignación de kits', users: 'Usuarios y roles', access: 'Solicitudes de acceso', devices: 'Aprobación de dispositivos', monitoring: 'Monitoreo', audit: 'Auditoría', maintenance: 'Mantenimiento' })[section]}</h1></div>{section === 'kits' && <button className="ma-primary" onClick={() => setKitModal({ ...EMPTY_KIT })}><Icon name="plus" />Crear nuevo kit</button>}</header>
      {notice && <div className={`ma-notice ma-notice--${notice.type}`} role="status"><span>{notice.type === 'success' ? '✓' : '!'}</span>{notice.text}<button aria-label="Cerrar aviso" onClick={() => setNotice(null)}>×</button></div>}

      {section === 'overview' && <Overview metrics={metrics} wifi={wifi} onSection={setSection} />}
      {section === 'wifi' && <WifiPanel wifi={wifi} networks={wifiNetworks} setWifi={setWifi} dirty={wifiDirty} setDirty={setWifiDirty} showPassword={showPassword} setShowPassword={setShowPassword} busy={busy} onSave={saveWifi} onTest={testWifi} onApply={applyWifi} />}
      {section === 'kits' && <KitsPanel kits={visibleKits} metrics={metrics} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onCopy={copyKey} onEdit={openKitEditor} onDelete={setDeleteTarget} onApplyNetwork={applyKitNetwork} />}
      {!['overview', 'wifi', 'kits'].includes(section) && <MasterAdminOperations
        section={section} usuario={usuario} kits={kits}
        notify={(type, text) => setNotice({ type, text })}
        onKitsChanged={loadKits} onRestored={onRestored} />}
    </section>

    {kitModal && <KitModal initial={kitModal} networks={wifiNetworks} busy={busy} onClose={() => setKitModal(null)} onSubmit={submitKit} />}
    {deleteTarget && <DeleteModal kit={deleteTarget} busy={busy} onClose={() => setDeleteTarget(null)} onConfirm={deleteKit} />}
  </main>;
}

function Overview({ metrics, wifi, onSection }) {
  return <><div className="ma-metrics"><Metric label="Kits registrados" value={metrics.total} detail={`${metrics.active} activos`} icon="kit"/><Metric label="Kits en línea" value={metrics.online} detail="Telemetría en 2 min" icon="grid"/><Metric label="Estado Wi-Fi" value={wifi.connectionStatus === 'connected' ? 'Online' : 'Offline'} detail={wifi.ssid || 'Sin configurar'} icon="wifi"/></div><div className="ma-overview-grid"><article className="ma-panel"><div className="ma-panel__title"><div><p>ACCESOS RÁPIDOS</p><h2>Configuración del sistema</h2></div></div><button className="ma-quick" onClick={() => onSection('wifi')}><span><Icon name="wifi" /></span><div><b>Red Wi-Fi</b><small>Credenciales, cifrado y prueba de conexión</small></div><strong>→</strong></button><button className="ma-quick" onClick={() => onSection('kits')}><span><Icon name="kit" /></span><div><b>Inventario de kits</b><small>Gateway y nodos registrados</small></div><strong>→</strong></button></article><article className="ma-panel ma-security"><Icon name="shield"/><p>POSTURA DE SEGURIDAD</p><h2>Protección de nivel administrador</h2><ul><li>Secretos cifrados en reposo</li><li>Acciones críticas auditadas</li><li>Tokens generados con CSPRNG</li></ul></article></div></>;
}

function Metric({ label, value, detail, icon }) {
  return <article className="ma-metric"><span><Icon name={icon}/></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function WifiPanel({ wifi, networks, setWifi, dirty, setDirty, showPassword, setShowPassword, busy, onSave, onTest, onApply }) {
  const update = (patch) => {
    setWifi({ ...wifi, ...patch, ...(patch.ssid !== undefined && patch.ssid !== wifi.ssid ? { passwordConfigured: false } : {}) });
    setDirty(true);
  };
  return <div className="ma-two-column">
    <form className="ma-panel ma-wifi-form" onSubmit={onSave}>
      <div className="ma-panel__title"><div><p>CREDENCIALES DE RED</p><h2>Registrar o actualizar una red</h2><small>Al guardar un SSID nuevo se añade al catálogo. Los kits conservan su red asignada aunque cambie la red principal.</small></div><StatusBadge status={wifi.connectionStatus}/></div>
      <label>Nombre de la red (SSID)<input value={wifi.ssid} onChange={(event) => update({ ssid: event.target.value })} maxLength="32" placeholder="Ej. SecureMesh-Lab" required /></label>
      <label>Tipo de seguridad<select value={wifi.securityType} onChange={(event) => update({ securityType: event.target.value, password: event.target.value === 'OPEN' ? '' : wifi.password })}><option value="WPA2">WPA2-Personal</option><option value="WPA3">WPA3-Personal</option><option value="WPA2_WPA3">WPA2 / WPA3 mixto</option><option value="OPEN">Red abierta</option></select></label>
      {wifi.securityType !== 'OPEN' && <label>Contraseña de la red<div className="ma-password"><input type={showPassword ? 'text' : 'password'} value={wifi.password} onChange={(event) => update({ password: event.target.value })} placeholder={wifi.passwordConfigured ? '•••••••••••• (sin cambios)' : 'Mínimo 8 caracteres'} minLength={wifi.passwordConfigured && !wifi.password ? undefined : 8} /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button></div><small>{wifi.passwordConfigured && !wifi.password ? 'Deja el campo vacío para conservar la contraseña cifrada actual.' : 'Se cifrará antes de almacenarse.'}</small></label>}
      <div className="ma-form-actions"><button type="button" className="ma-secondary" onClick={onTest} disabled={busy || !wifi.ssid || dirty}><Icon name="wifi" />Probar conexión</button><button className="ma-primary" disabled={busy || !wifi.ssid}>{busy ? 'Procesando…' : 'Guardar configuración'}</button></div>
      <button type="button" className="ma-secondary" onClick={onApply} disabled={busy || dirty || !wifi.gatewayAdapterConfigured || !wifi.ssid}>Aplicar red principal al Gateway predeterminado</button>
      {dirty && <p className="ma-ops-muted">Guarda los cambios antes de probar o aplicar la red.</p>}
      {!wifi.gatewayAdapterConfigured && <p className="ma-ops-muted">Para aplicar la red, configura WIFI_PROVISIONING_URL en el servidor.</p>}
    </form>
    <aside className="ma-panel ma-network-state"><div className="ma-signal"><Icon name="wifi" /></div><p>RED PRINCIPAL Y REDES DISPONIBLES</p><h2>{wifi.ssid || 'Red sin configurar'}</h2><StatusBadge status={wifi.connectionStatus}/>{wifi.lastTestedAt && <small>Última prueba o aplicación: {new Date(wifi.lastTestedAt).toLocaleString()}</small>}{wifi.lastError && <div className="ma-inline-warning">{wifi.lastError}</div>}<div className="ma-security-note"><Icon name="shield"/><span><b>Credenciales protegidas</b><small>La contraseña nunca se devuelve al navegador ni se registra en logs.</small></span></div><h3>Redes registradas</h3>{networks.length ? <ul>{networks.map((network) => <li key={network.id}>{network.ssid} · {network.securityType} · {network.kitCount} kit(s)</li>)}</ul> : <p className="ma-ops-muted">Guarda una red para poder registrar kits.</p>}</aside>
  </div>;
}

function KitsPanel({ kits, metrics, query, setQuery, filter, setFilter, onCopy, onEdit, onDelete, onApplyNetwork }) {
  return <><div className="ma-metrics"><Metric label="Total de kits" value={metrics.total} detail="Inventario visible" icon="kit"/><Metric label="Activos" value={metrics.active} detail="Disponibles para operar" icon="shield"/><Metric label="En línea" value={metrics.online} detail="Detectados recientemente" icon="wifi"/></div><section className="ma-panel ma-table-panel"><div className="ma-toolbar"><label className="ma-search"><Icon name="search"/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por kit, clave, red, gateway o nodo…" /></label><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrar por estado"><option value="all">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="online">En línea</option></select></div><div className="ma-table-wrap"><table><thead><tr><th>Kit</th><th>Clave única</th><th>Gateway</th><th>Red Wi-Fi</th><th>Nodos asociados</th><th>Estado</th><th aria-label="Acciones" /></tr></thead><tbody>{kits.map((kit) => <tr key={kit.id}><td><b>{kit.name}</b><small>Creado {new Date(kit.createdAt).toLocaleDateString()}</small></td><td><div className="ma-key"><code>{kit.uniqueKey || 'No recuperable'}</code><button onClick={() => onCopy(kit)} aria-label={`Copiar clave de ${kit.name}`}><Icon name="copy"/></button></div></td><td><code>{kit.gatewayIdentifier}</code></td><td>{kit.wifiSsid ? <><b>{kit.wifiSsid}</b><small>{kit.wifiSecurityType}</small></> : <span>Sin asignar</span>}</td><td><div className="ma-node-list">{kit.components.map((component) => <span key={component.id}>{component.component_role.replace('node_', 'N')}: {component.identifier}</span>)}</div></td><td><StatusBadge status={kit.status}/></td><td><div className="ma-row-actions"><button onClick={() => onEdit(kit)} aria-label={`Ver o editar ${kit.name}`}><Icon name="edit"/></button><button onClick={() => onApplyNetwork(kit)} disabled={!kit.wifiNetworkId} aria-label={`Aplicar red de ${kit.name}`} title="Aplicar red al Gateway del kit"><Icon name="wifi"/></button><button className="danger" onClick={() => onDelete(kit)} aria-label={`Eliminar ${kit.name}`}><Icon name="trash"/></button></div></td></tr>)}{!kits.length && <tr><td colSpan="7" className="ma-empty"><span><Icon name="kit"/></span><b>No hay kits que coincidan</b><small>Crea un kit o cambia los filtros de búsqueda.</small></td></tr>}</tbody></table></div></section></>;
}

function KitModal({ initial, networks, busy, onClose, onSubmit }) {
  const [form, setForm] = useState(initial);
  const editing = Boolean(initial.id);
  const updateNode = (index, value) => setForm((current) => ({
    ...current, nodeIdentifiers: current.nodeIdentifiers.map((node, i) => i === index ? value : node),
  }));
  const connectedNode = (index) => initial.components?.find((component) =>
    component.component_role === `node_${index + 1}`)?.connected;

  return <div className="ma-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="ma-modal" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
      <header><div><p>{editing ? 'EDICIÓN DE NODOS Y GATEWAY' : 'REGISTRO DE HARDWARE'}</p><h2>{editing ? initial.name : 'Crear nuevo kit'}</h2></div><button type="button" onClick={onClose} aria-label="Cerrar"><Icon name="close"/></button></header>
      <div className="ma-kit-rule"><span>1</span> Gateway <i/> <span>3</span> Nodos <strong>Composición obligatoria</strong></div>
      {editing && <p className="ma-component-help">Solo puedes retirar o sustituir dispositivos sin actividad reciente. Retira el identificador anterior y escribe el nuevo antes de guardar; el kit debe conservar 1 Gateway y 3 nodos. Los dispositivos ya registrados no se admiten. Después del cambio debes aprovisionar el firmware del hardware nuevo.</p>}
      <div className="ma-component-field">
        <div className="ma-component-field__heading"><label htmlFor="ma-gateway-id">Gateway</label>{editing && <><span>{initial.gatewayConnected ? 'Conectado' : 'Sin actividad reciente'}</span><button type="button" disabled={busy || initial.gatewayConnected} onClick={() => setForm((current) => ({ ...current, gatewayIdentifier: '' }))}>Retirar</button></>}</div>
        <input id="ma-gateway-id" value={form.gatewayIdentifier} onChange={(event) => setForm((current) => ({ ...current, gatewayIdentifier: event.target.value }))} placeholder="MAC, serial o ID del Gateway" disabled={editing && initial.gatewayConnected} required />
      </div>
      <div className="ma-node-fields">{form.nodeIdentifiers.map((node, index) => <div className="ma-component-field" key={index}>
        <div className="ma-component-field__heading"><label htmlFor={`ma-node-${index}`}>Nodo {index + 1}</label>{editing && <><span>{connectedNode(index) ? 'Conectado' : 'Sin actividad reciente'}</span><button type="button" disabled={busy || connectedNode(index)} onClick={() => updateNode(index, '')}>Retirar</button></>}</div>
        <input id={`ma-node-${index}`} value={node} onChange={(event) => updateNode(index, event.target.value)} placeholder={`MAC, serial o ID del nodo ${index + 1}`} disabled={editing && connectedNode(index)} required />
      </div>)}</div>
      {editing && <label>Estado<select value={form.status === 'online' ? 'active' : form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>}
      <label>Red Wi-Fi del kit<select value={form.wifiNetworkId || ''} onChange={(event) => setForm({ ...form, wifiNetworkId: event.target.value })} required><option value="">Selecciona una red registrada</option>{networks.map((network) => <option key={network.id} value={network.id}>{network.ssid} ({network.securityType})</option>)}</select></label>
      {!networks.length && <p className="ma-ops-muted">Primero registra una red en la sección Red Wi-Fi.</p>}
      <label>Notas operativas <span>(opcional)</span><textarea value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength="500" placeholder="Ubicación, responsable o referencia…" /></label>
      <footer><button type="button" className="ma-secondary" onClick={onClose}>Cancelar</button><button className="ma-primary" disabled={busy || !networks.length}>{busy ? 'Procesando…' : editing ? 'Guardar cambios' : 'Crear kit y generar clave'}</button></footer>
    </form>
  </div>;
}

function DeleteModal({ kit, busy, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState('');
  return <div className="ma-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="ma-modal ma-delete-modal" role="alertdialog" aria-modal="true"><div className="ma-danger-icon"><Icon name="trash"/></div><h2>Eliminar {kit.name}</h2><p>Esta acción desvinculará el Gateway y sus tres nodos, eliminará solicitudes asociadas y revocará la clave única.</p><label>Escribe <b>{kit.name}</b> para confirmar<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus /></label><footer><button className="ma-secondary" onClick={onClose}>Cancelar</button><button className="ma-danger-button" disabled={busy || confirmation !== kit.name} onClick={onConfirm}>{busy ? 'Eliminando…' : 'Eliminar definitivamente'}</button></footer></section></div>;
}
