import { useCallback, useEffect, useState } from 'react';
import { Page, CardHeader, Empty } from './Dashboard';
import { claimKit, decideDevice, listCandidates, listDeviceRequests, listInventory, listKits, requestDevice, startScan } from '../services/kits.service';

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

  return <Page><header className="page-heading"><div><p className="eyebrow">KIT ESP32</p><h1>Mis dispositivos</h1><p>Busca los tres nodos de tu kit y solicita su conexión al Gateway.</p></div></header>
    {feedback && <p className="feedback" role="status">{feedback}</p>}
    <section className="card form-card"><CardHeader eyebrow="PRIMER PASO" title="Vincular tu kit" /><form className="node-form" onSubmit={claim}><label>Código del kit<input value={claimCode} onChange={(event) => setClaimCode(event.target.value)} placeholder="Código incluido con el kit" required minLength="12" /></label><button className="primary-button" disabled={busy}>Vincular kit</button></form></section>
    {!!kits.length && <section className="card table-card spaced"><CardHeader eyebrow="GATEWAY" title="Buscar dispositivos" /><div className="node-form"><label>Gateway<select value={selected} onChange={(event) => setSelected(event.target.value)}>{kits.map((kit) => <option key={kit.id} value={kit.id}>{kit.gateway_id} · {kit.device_count} nodos</option>)}</select></label><button className="primary-button" onClick={search} disabled={busy}>Buscar Dispositivos</button></div><div className="table-scroll"><table><thead><tr><th>Nodo del kit</th><th>Conectividad</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{candidates.map((device) => <tr key={device.id}><td><b>{device.device_id}</b></td><td>{device.detected_transport === 'ble' ? 'Bluetooth BLE' : 'Wi-Fi / ESP-NOW'}</td><td>{device.request_status === 'approved' ? 'Aprobado' : device.request_status === 'pending' ? 'Pendiente de aprobación' : 'Detectado'}</td><td><button className="ghost-button" onClick={() => link(device)} disabled={busy || ['pending', 'approved'].includes(device.request_status)}>Vincular al Gateway</button></td></tr>)}{!candidates.length && <Empty colSpan="4" text="Aún no se detectan nodos de este kit." />}</tbody></table></div></section>}
    {isAdvanced && !!kits.length && <section className="card form-card spaced"><CardHeader eyebrow="ZONA TÉCNICA" title="Registro manual de un nodo del kit" /><form className="node-form" onSubmit={manual}><label>Identificador del nodo<select value={manualId} onChange={(event) => setManualId(event.target.value)} required><option value="">Selecciona un nodo del inventario</option>{inventory.map((device) => <option key={device.id} value={device.device_id}>{device.device_id} · {device.mac_address}</option>)}</select></label><button className="primary-button" disabled={busy}>Crear solicitud manual</button></form><p>Los IDs y MAC se toman del inventario físico del kit para impedir dispositivos externos.</p></section>}
    <section className="card table-card spaced"><CardHeader eyebrow={isAdvanced ? 'ZONA TÉCNICA' : 'SEGUIMIENTO'} title={isAdvanced ? 'Solicitudes de aprobación' : 'Mis solicitudes'} /><div className="table-scroll"><table><thead><tr><th>Nodo</th><th>Gateway</th><th>Solicitante</th><th>Estado</th>{isAdvanced && <th>Decisión</th>}</tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td>{request.device_id}</td><td>{request.gateway_id}</td><td>{request.requester_name}</td><td>{request.status === 'pending' ? 'Pendiente de aprobación' : request.status === 'approved' ? 'Aprobado' : `Rechazado: ${request.reason || ''}`}</td>{isAdvanced && <td>{request.status === 'pending' && <div className="row-actions"><button className="ghost-button" onClick={() => decide(request, 'approve')} disabled={busy}>Aprobar</button><button className="ghost-button" onClick={() => decide(request, 'reject')} disabled={busy}>Rechazar</button></div>}</td>}</tr>)}{!requests.length && <Empty colSpan={isAdvanced ? '5' : '4'} text="No hay solicitudes." />}</tbody></table></div></section>
  </Page>;
}
