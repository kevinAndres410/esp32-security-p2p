import { useCallback, useEffect, useState } from 'react';
import { getNodes, registerNode, blockNode, unblockNode, deleteNode } from '../services/nodes.service';
import { subscribe } from '../services/socket.service';
import { CardHeader, Empty, Page, Status } from './Dashboard';

export default function NodesManagement() {
  const [nodes, setNodes] = useState([]);
  const [form, setForm] = useState({ deviceId: '', macAddress: '', descripcion: '' });
  const [generatedKey, setGeneratedKey] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setNodes(await getNodes()); } catch { setFeedback('No fue posible cargar los nodos.'); } }, []);

  useEffect(() => { load(); return subscribe('estado_red', (data) => setNodes(data.nodos || [])); }, [load]);
  const submit = async (event) => { event.preventDefault(); setBusy(true); setFeedback(''); try { await registerNode(form); setGeneratedKey(''); setForm({ deviceId: '', macAddress: '', descripcion: '' }); setFeedback('Solicitud enviada. El nodo queda pendiente de aprobación.'); await load(); } catch (error) { setFeedback(error.message || 'No fue posible solicitar el nodo.'); } finally { setBusy(false); } };
  const toggle = async (node) => { node.estado === 'bloqueado' ? await unblockNode(node.device_id) : await blockNode(node.device_id); await load(); };
  const remove = async (id) => { if (!window.confirm(`¿Eliminar el nodo ${id}?`)) return; await deleteNode(id); await load(); };

  return <Page><header className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN IOT</p><h1>Gestión de nodos</h1><p>Registra y supervisa los dispositivos ESP32 conectados a la red segura.</p></div></header>
    <section className="card form-card"><CardHeader eyebrow="NUEVO DISPOSITIVO" title="Registrar nuevo nodo" /><form className="node-form" onSubmit={submit}><label>Identificador del dispositivo (Device ID) <span>Obligatorio</span><input value={form.deviceId} onChange={(event) => setForm({ ...form, deviceId: event.target.value })} placeholder="ESP32-NORTE-01" required /></label><label>Dirección MAC <span>Obligatorio</span><input value={form.macAddress} onChange={(event) => setForm({ ...form, macAddress: event.target.value })} placeholder="A4:F1:C1:12:34:56" pattern="[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}" required /></label><label>Descripción <span>Opcional</span><input value={form.descripcion} onChange={(event) => setForm({ ...form, descripcion: event.target.value })} placeholder="Nodo Sector Norte - Sensor T1" /></label><button className="primary-button" disabled={busy}>{busy ? 'Registrando…' : 'Registrar →'}</button></form>{feedback && <p className="feedback">{feedback}</p>}{generatedKey && <p className="secret-output">Clave generada — guárdala ahora: <code>{generatedKey}</code></p>}</section>
    <section className="card table-card spaced"><CardHeader eyebrow="INVENTARIO" title={`Nodos registrados · ${nodes.length}`} /><div className="table-scroll"><table><thead><tr><th>Device ID</th><th>MAC</th><th>Descripción</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{nodes.map((node) => <tr key={node.device_id}><td><span className="device-mark">⌁</span><b>{node.device_id}</b></td><td><code>{node.mac_address || '-'}</code></td><td>{node.descripcion || 'Sin descripción'}</td><td><Status active={node.estado === 'activo'} /></td><td className="row-actions"><button className="ghost-button" onClick={() => toggle(node)}>{node.estado === 'bloqueado' ? 'Activar' : 'Bloquear'}</button><button className="icon-button" onClick={() => remove(node.device_id)} aria-label={`Eliminar ${node.device_id}`}>⌫</button></td></tr>)}{!nodes.length && <Empty colSpan="5" text="No hay nodos registrados aún." />}</tbody></table></div></section>
  </Page>;
}
