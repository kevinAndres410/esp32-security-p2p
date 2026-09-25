import { useEffect, useState } from 'react';
import { getNodes } from '../services/nodes.service';
import { getKeyInfo, rotateAllKeys, rotateKey } from '../services/keys.service';
import { CardHeader, Empty, Page } from './Dashboard';

export default function KeyRotationSettings() {
  const [nodes, setNodes] = useState([]);
  const [keyInfo, setKeyInfo] = useState({});
  const [visible, setVisible] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => { getNodes().then(setNodes).catch(() => setFeedback('No fue posible cargar los nodos.')); }, []);
  const loadKey = async (id, force = false) => { if (keyInfo[id] && !force) return; try { const info = await getKeyInfo(id); setKeyInfo((current) => ({ ...current, [id]: info })); } catch { setFeedback(`No fue posible consultar la clave de ${id}.`); } };
  const rotateNodeKey = async (id) => { setBusy(id); try { await rotateKey(id); await loadKey(id, true); setFeedback(`Clave de ${id} rotada correctamente.`); } catch { setFeedback(`No fue posible rotar la clave de ${id}.`); } finally { setBusy(''); } };
  const rotateAll = async () => { setBusy('global'); try { const result = await rotateAllKeys(); setFeedback(`${result.mensaje}: ${result.nodosRotados} nodo(s).`); } catch (error) { setFeedback(error.message); } finally { setBusy(''); setConfirming(false); } };

  return <Page><header className="page-heading"><div><p className="eyebrow">SEGURIDAD CRIPTOGRÁFICA</p><h1>Configuración de rotación de claves</h1><p>Administra el ciclo de vida de las claves de cifrado de la red IoT.</p></div></header>
    <section className="card global-rotation"><div className="rotation-icon">↻</div><div><p className="eyebrow">ROTACIÓN GLOBAL</p><h2>Rotación global</h2><p>Rota la clave activa de todos los nodos conectados.</p></div><button className="primary-button" onClick={() => setConfirming(true)} disabled={busy === 'global'}>Rotar clave global ahora ↻</button></section>{feedback && <p className="feedback">{feedback}</p>}
    <section className="card table-card spaced"><CardHeader eyebrow="GESTIÓN GRANULAR" title="Rotación por nodo" /><div className="table-scroll"><table><thead><tr><th>Device ID</th><th>Clave actual</th><th>Última actividad</th><th>Acciones</th></tr></thead><tbody>{nodes.map((node) => { const info = keyInfo[node.device_id]; const rawKey = info?.claveActual || node.clave_actual; return <tr key={node.device_id} onMouseEnter={() => loadKey(node.device_id)}><td><span className="device-mark">⌁</span><b>{node.device_id}</b></td><td><code>{visible[node.device_id] && rawKey ? maskKey(rawKey) : '••••••••••••3F8A'}</code><button className="reveal-button" onClick={() => setVisible((current) => ({ ...current, [node.device_id]: !current[node.device_id] }))}>{visible[node.device_id] ? 'Ocultar' : 'Ver'}</button></td><td>{formatDate(info?.ultimaActividad || node.ultima_actividad)}</td><td><button className="ghost-button" onClick={() => rotateNodeKey(node.device_id)} disabled={busy === node.device_id}>{busy === node.device_id ? 'Rotando…' : 'Rotar clave ↻'}</button></td></tr>; })}{!nodes.length && <Empty colSpan="4" text="No hay nodos disponibles." />}</tbody></table></div></section>
    {confirming && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setConfirming(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="rotation-confirm"><div className="rotation-icon">↻</div><h2 id="rotation-confirm">¿Rotar todas las claves?</h2><p>La operación actualizará las claves de todos los nodos conectados. Esta acción no puede deshacerse.</p><div className="modal-actions"><button className="ghost-button" onClick={() => setConfirming(false)}>Cancelar</button><button className="primary-button" onClick={rotateAll}>Sí, rotar ahora</button></div></section></div>}
  </Page>;
}

const maskKey = (key) => key.length > 8 ? `••••••••${key.slice(-8)}` : key;
const formatDate = (date) => date ? `${new Date(date).toLocaleDateString('es-CO')} · ${new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '-';
