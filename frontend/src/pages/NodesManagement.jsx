import { useEffect, useState } from 'react';
import { getNodes, registerNode, blockNode, unblockNode, deleteNode } from '../services/nodes.service';
import { subscribe } from '../services/socket.service';

export default function NodesManagement() {
  const [nodos, setNodos] = useState([]);
  const [form, setForm] = useState({ deviceId: '', descripcion: '' });
  const [claveNueva, setClaveNueva] = useState(null);

  const cargarNodos = async () => setNodos(await getNodes());

  useEffect(() => {
    cargarNodos();
    const unsub = subscribe('estado_red', (data) => setNodos(data.nodos || []));
    return unsub;
  }, []);

  const handleRegistrar = async (e) => {
    e.preventDefault();
    const result = await registerNode(form);
    if (result.claveActual) setClaveNueva(result.claveActual);
    setForm({ deviceId: '', descripcion: '' });
    cargarNodos();
  };

  const handleBloquear = async (deviceId) => {
    await blockNode(deviceId);
    cargarNodos();
  };

  const handleDesbloquear = async (deviceId) => {
    await unblockNode(deviceId);
    cargarNodos();
  };

  const handleEliminar = async (deviceId) => {
    if (!window.confirm(`¿Eliminar nodo ${deviceId}?`)) return;
    await deleteNode(deviceId);
    cargarNodos();
  };

  return (
    <div>
      <h1>Gestión de nodos</h1>

      <form onSubmit={handleRegistrar}>
        <h2>Registrar nuevo nodo</h2>
        <input
          placeholder="Device ID (ej. esp32-004)"
          value={form.deviceId}
          onChange={(e) => setForm({ ...form, deviceId: e.target.value })}
          required
        />
        <input
          placeholder="Descripción (opcional)"
          value={form.descripcion}
          onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
        />
        <button type="submit">Registrar</button>
      </form>

      {claveNueva && (
        <p>
          Clave compartida generada (grábala en el firmware del ESP32, no se
          volverá a mostrar): <code>{claveNueva}</code>
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th>Device ID</th>
            <th>Descripción</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {nodos.map((n) => (
            <tr key={n.device_id}>
              <td>{n.device_id}</td>
              <td>{n.descripcion || '-'}</td>
              <td>{n.estado}</td>
              <td>
                {n.estado === 'bloqueado' ? (
                  <button onClick={() => handleDesbloquear(n.device_id)}>Desbloquear</button>
                ) : (
                  <button onClick={() => handleBloquear(n.device_id)}>Bloquear</button>
                )}
                <button onClick={() => handleEliminar(n.device_id)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
