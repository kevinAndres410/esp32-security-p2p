import { useCallback, useEffect, useState } from 'react';
import { Page, CardHeader, Empty } from './Dashboard';
import { claimKit, createDeviceOperation, decideDevice, listCandidates, listDeviceOperations, listDeviceRequests, listInventory, listKits, replaceNodeHardware, requestDevice, startScan } from '../services/kits.service';

export default function KitDevices({ isAdvanced }) {
  const [kits, setKits] = useState([]);
  const [selected, setSelected] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [requests, setRequests] = useState([]);
  const [claimCode, setClaimCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [manualId, setManualId] = useState('');
  const [replacementMac, setReplacementMac] = useState('');

  const refresh = useCallback(async () => {
    const [availableKits, allRequests] = await Promise.all([listKits(), listDeviceRequests()]);
    setKits(availableKits);
    setRequests(allRequests);
    setSelected((current) => current || (availableKits[0] ? String(availableKits[0].id) : ''));
  }, []);
  useEffect(() => { refresh().catch((error) => setFeedback(error.message)); }, [refresh]);
  useEffect(() => {
    if (!selected) { setCandidates([]); return undefined; }
    const load = () => listCandidates(selected).then(setCandidates).catch((error) => setFeedback(error.message));
    load();
    if (isAdvanced) listInventory(selected).then(setInventory).catch((error) => setFeedback(error.message));
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [selected, isAdvanced]);

  const run = async (operation, success) => {
    setBusy(true); setFeedback('');
    try { await operation(); await refresh(); if (selected) setCandidates(await listCandidates(selected)); setFeedback(success); }
    catch (error) { setFeedback(error.message); }
    finally { setBusy(false); }
  };

  const claim = (event) => { event.preventDefault(); run(() => claimKit(claimCode), 'Kit vinculado a tu cuenta.'); setClaimCode(''); };
  const search = () => run(() => startScan(selected), 'Buscando nodos del kit. La lista se actualizará al recibir señales del Gateway.');
  const link = (device, method = 'automatic') => run(() => requestDevice(selected, device.id, method), 'Solicitud enviada. Pendiente de aprobación.');
  const decide = (request, action) => {
    const reason = action === 'reject' ? window.prompt('Motivo del rechazo:') : '';
    if (action === 'reject' && !reason) return;
    if (action === 'approve' && !window.confirm(`¿Aprobar ${request.device_id} para ${request.gateway_id}?`)) return;
    run(() => decideDevice(request.id, action, reason), action === 'approve' ? 'Dispositivo aprobado.' : 'Solicitud rechazada.');
  };
  const manual = (event) => {
    event.preventDefault();
    const device = inventory.find((candidate) => candidate.device_id === manualId);
    if (!device) { setFeedback('Selecciona un nodo del inventario del kit.'); return; }
    link(device, 'manual');
  };
  const nodeTwo = inventory.find((device) => device.component_role === 'node_2');
  const replaceNodeTwo = (event) => {
    event.preventDefault();
    if (!nodeTwo) return;
    run(async () => {
      await replaceNodeHardware(selected, nodeTwo.device_id, replacementMac);
      setInventory(await listInventory(selected));
      setReplacementMac('');
    }, 'Placa del nodo 2 sustituida en el inventario del kit. Solicita y aprueba su vinculación.');
  };

  const selectedKit = kits.find((kit) => String(kit.id) === selected);
  if (selectedKit?.dynamic_config_enabled) {
    return <DynamicKitView kitId={selected} kits={kits} onSelect={setSelected} />;
  }

  return <Page><header className="page-heading"><div><p className="eyebrow">KIT ESP32</p><h1>Mis dispositivos</h1><p>Busca los tres nodos de tu kit y solicita su conexión al Gateway.</p></div></header>
    {feedback && <p className="feedback" role="status">{feedback}</p>}
    <section className="card form-card"><CardHeader eyebrow="PRIMER PASO" title="Vincular tu kit" /><form className="node-form" onSubmit={claim}><label>Código del kit<input value={claimCode} onChange={(event) => setClaimCode(event.target.value)} placeholder="Código incluido con el kit" required minLength="12" /></label><button className="primary-button" disabled={busy}>Vincular kit</button></form></section>
    {!!kits.length && <section className="card table-card spaced"><CardHeader eyebrow="GATEWAY" title="Buscar dispositivos" /><div className="node-form"><label>Gateway<select value={selected} onChange={(event) => setSelected(event.target.value)}>{kits.map((kit) => <option key={kit.id} value={kit.id}>{kit.gateway_id} · {kit.device_count} nodos</option>)}</select></label><button className="primary-button" onClick={search} disabled={busy}>Buscar Dispositivos</button></div><div className="table-scroll"><table><thead><tr><th>Nodo del kit</th><th>Conectividad</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{candidates.map((device) => <tr key={device.id}><td><b>{device.device_id}</b></td><td>{device.detected_transport === 'ble' ? 'Bluetooth BLE' : 'Wi-Fi / ESP-NOW'}</td><td>{device.request_status === 'approved' ? 'Aprobado' : device.request_status === 'pending' ? 'Pendiente de aprobación' : 'Detectado'}</td><td><button className="ghost-button" onClick={() => link(device)} disabled={busy || ['pending', 'approved'].includes(device.request_status)}>Vincular al Gateway</button></td></tr>)}{!candidates.length && <Empty colSpan="4" text="Aún no se detectan nodos de este kit." />}</tbody></table></div></section>}
    {isAdvanced && !!kits.length && <section className="card form-card spaced"><CardHeader eyebrow="ZONA TÉCNICA" title="Registro manual de un nodo del kit" /><form className="node-form" onSubmit={manual}><label>Identificador del nodo<select value={manualId} onChange={(event) => setManualId(event.target.value)} required><option value="">Selecciona un nodo del inventario</option>{inventory.map((device) => <option key={device.id} value={device.device_id}>{device.device_id} · {device.mac_address}</option>)}</select></label><button className="primary-button" disabled={busy}>Crear solicitud manual</button></form><p>Los IDs y MAC se toman del inventario físico del kit para impedir dispositivos externos.</p></section>}
    {isAdvanced && nodeTwo && <section className="card form-card spaced"><CardHeader eyebrow="MANTENIMIENTO DEL KIT" title="Sustituir la placa del nodo 2" /><p>{nodeTwo.device_id} · MAC actual: <code>{nodeTwo.mac_address}</code></p><p>Graba el firmware en la placa nueva y desconecta la anterior. Elimina su registro en Gestión de nodos antes de cambiar la MAC del kit.</p><form className="node-form" onSubmit={replaceNodeTwo}><label>MAC de la nueva placa<input value={replacementMac} onChange={(event) => setReplacementMac(event.target.value)} placeholder="AA:BB:CC:DD:EE:FF" pattern="[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}" required /></label><button className="primary-button" disabled={busy}>Agregar placa nueva al kit</button></form></section>}
    <section className="card table-card spaced"><CardHeader eyebrow={isAdvanced ? 'ZONA TÉCNICA' : 'SEGUIMIENTO'} title={isAdvanced ? 'Solicitudes de aprobación' : 'Mis solicitudes'} /><div className="table-scroll"><table><thead><tr><th>Nodo</th><th>Gateway</th><th>Solicitante</th><th>Estado</th>{isAdvanced && <th>Decisión</th>}</tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td>{request.device_id}</td><td>{request.gateway_id}</td><td>{request.requester_name}</td><td>{request.status === 'pending' ? 'Pendiente de aprobación' : request.status === 'approved' ? 'Aprobado' : `Rechazado: ${request.reason || ''}`}</td>{isAdvanced && <td>{request.status === 'pending' && <div className="row-actions"><button className="ghost-button" onClick={() => decide(request, 'approve')} disabled={busy}>Aprobar</button><button className="ghost-button" onClick={() => decide(request, 'reject')} disabled={busy}>Rechazar</button></div>}</td>}</tr>)}{!requests.length && <Empty colSpan={isAdvanced ? '5' : '4'} text="No hay solicitudes." />}</tbody></table></div></section>
  </Page>;
}

const operationLabels = {
  pending_gateway: 'Pendiente del Gateway',
  awaiting_telemetry: 'Esperando señal del nodo',
  online: 'Conectado',
  removed: 'Retirado',
  superseded: 'Sustituido por otro cambio',
};

function DynamicKitView({ kitId, kits, onSelect }) {
  const [currentKit, setCurrentKit] = useState(kits.find((kit) => String(kit.id) === kitId));
  const [nodes, setNodes] = useState([]);
  const [operations, setOperations] = useState([]);
  const [action, setAction] = useState('add');
  const [deviceId, setDeviceId] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [allKits, inventory, history] = await Promise.all([
          listKits(), listInventory(kitId), listDeviceOperations(kitId),
        ]);
        if (!active) return;
        setCurrentKit(allKits.find((kit) => String(kit.id) === kitId));
        setNodes(inventory);
        setOperations(history);
      } catch (error) { if (active) setFeedback(error.message); }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [kitId]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setFeedback('');
    try {
      await createDeviceOperation(kitId, action, deviceId, activationCode);
      setActivationCode('');
      setDeviceId('');
      const [inventory, history, allKits] = await Promise.all([
        listInventory(kitId), listDeviceOperations(kitId), listKits(),
      ]);
      setNodes(inventory);
      setOperations(history);
      setCurrentKit(allKits.find((kit) => String(kit.id) === kitId));
      setFeedback('Cambio solicitado. La conexión se confirmará después de aplicar la configuración y recibir datos del nodo.');
    } catch (error) { setFeedback(error.message); }
    finally { setBusy(false); }
  };

  const nodeState = (node) => {
    if (node.operation_status === 'pending_gateway') return 'Pendiente del Gateway';
    if (node.operation_status === 'awaiting_telemetry') return 'Esperando señal del nodo';
    return node.connected ? 'Conectado' : 'Sin señal reciente';
  };

  return <Page>
    <header className="page-heading"><div><p className="eyebrow">KIT ESP32</p><h1>Mis dispositivos</h1><p>Gestiona las placas preparadas para este kit y verifica su conexión real.</p></div></header>
    {feedback && <p className="feedback" role="status">{feedback}</p>}
    <section className="card form-card">
      <label>Kit <select value={kitId} onChange={(event) => onSelect(event.target.value)}>
        {kits.map((kit) => <option key={kit.id} value={kit.id}>{kit.gateway_id}</option>)}
      </select></label>
      <p>Gateway: <b>{currentKit?.gateway_online ? 'En línea' : 'Sin conexión reciente'}</b> · Configuración {currentKit?.applied_version ?? 0} / {currentKit?.config_version ?? 0}</p>
    </section>
    <section className="card table-card spaced"><CardHeader eyebrow="DISPOSITIVOS" title="Nodos del kit" />
      <div className="table-scroll"><table><thead><tr><th>Posición</th><th>Nodo</th><th>MAC</th><th>Estado</th></tr></thead><tbody>
        {nodes.map((node) => <tr key={node.id}><td>{node.component_role}</td><td>{node.device_id}</td><td><code>{node.mac_address}</code></td><td>{nodeState(node)}</td></tr>)}
        {!nodes.length && <Empty colSpan="4" text="Este kit no tiene nodos activos en el inventario." />}
      </tbody></table></div>
    </section>
    <section className="card form-card spaced"><CardHeader eyebrow="GESTIÓN" title="Agregar, reemplazar o retirar" />
      <form className="node-form" onSubmit={submit}>
        <label>Acción<select value={action} onChange={(event) => { setAction(event.target.value); setDeviceId(''); }}>
          <option value="add">Agregar nodo</option><option value="replace">Reemplazar nodo</option><option value="remove">Retirar nodo</option>
        </select></label>
        {action !== 'add' && <label>Nodo actual<select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} required>
          <option value="">Selecciona un nodo</option>{nodes.map((node) => <option key={node.id} value={node.device_id}>{node.component_role} · {node.device_id}</option>)}
        </select></label>}
        {action !== 'remove' && <label>Código de activación de la placa nueva<input value={activationCode}
          onChange={(event) => setActivationCode(event.target.value)} autoComplete="off" minLength="20" required /></label>}
        <button className="primary-button" disabled={busy}>{busy ? 'Enviando…' : 'Solicitar cambio'}</button>
      </form>
      <p>La placa debe tener su firmware y credenciales de fábrica. La MAC sola no autoriza el ingreso.</p>
    </section>
    <section className="card table-card spaced"><CardHeader eyebrow="SEGUIMIENTO" title="Cambios recientes" />
      <div className="table-scroll"><table><thead><tr><th>Acción</th><th>Nodo</th><th>Estado</th><th>Versión</th></tr></thead><tbody>
        {operations.map((operation) => <tr key={operation.id}><td>{({ add: 'Agregar', replace: 'Reemplazar', remove: 'Retirar' })[operation.action]}</td>
          <td>{operation.device_id}</td><td>{operationLabels[operation.status] || operation.status}</td><td>{operation.config_version}</td></tr>)}
        {!operations.length && <Empty colSpan="4" text="Aún no hay cambios solicitados." />}
      </tbody></table></div>
    </section>
  </Page>;
}
