import { useCallback, useEffect, useMemo, useState } from 'react';
import { getNodes } from '../services/nodes.service';
import { subscribe } from '../services/socket.service';
import { CardHeader, Empty, Page, Status, relativeTime } from './Dashboard';

export default function DeviceAdministration({ onNavigate }) {
  const [nodes, setNodes] = useState([]);
  const [query, setQuery] = useState('');
  const load = useCallback(async () => setNodes(await getNodes()), []);
  useEffect(() => { load(); return subscribe('estado_red', (data) => setNodes(data.nodos || [])); }, [load]);
  const visible = useMemo(() => nodes.filter((node) => `${node.device_id} ${node.mac_address || ''} ${node.descripcion || ''}`.toLowerCase().includes(query.toLowerCase())), [nodes, query]);

  return <Page><header className="page-heading"><div><p className="eyebrow">ZONA TÉCNICA</p><h1>Administración de dispositivos</h1><p>Vincula, localiza y monitorea los dispositivos conectados.</p></div><button className="primary-button" onClick={() => onNavigate('nodos')}>Registrar nodo</button></header><section className="device-summary"><article className="card"><strong>{nodes.length}</strong><span>Dispositivos vinculados</span></article><article className="card"><strong>{nodes.filter((node) => node.estado === 'activo').length}</strong><span>En línea ahora</span></article><article className="card"><strong>{nodes.filter((node) => node.estado === 'bloqueado').length}</strong><span>Bloqueados</span></article></section><section className="card table-card spaced"><CardHeader eyebrow="MONITOREO" title="Dispositivos conectados" /><div className="device-search"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por ID, MAC o descripción…" /></div><div className="table-scroll"><table><thead><tr><th>Dispositivo</th><th>MAC</th><th>Última actividad</th><th>Estado</th></tr></thead><tbody>{visible.map((node) => <tr key={node.device_id}><td><span className="device-mark">⌁</span><b>{node.device_id}</b><small className="table-subtitle">{node.descripcion || 'Sin descripción'}</small></td><td><code>{node.mac_address || '-'}</code></td><td>{node.ultima_actividad ? relativeTime(node.ultima_actividad) : '-'}</td><td><Status active={node.estado === 'activo'} /></td></tr>)}{!visible.length && <Empty colSpan="4" text="No se encontraron dispositivos." />}</tbody></table></div></section></Page>;
}
