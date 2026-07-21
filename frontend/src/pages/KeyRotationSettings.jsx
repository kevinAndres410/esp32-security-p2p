import { useEffect, useState } from 'react';
import { getNodes } from '../services/nodes.service';
import { getKeyInfo, rotateKey } from '../services/keys.service';
import { rotarClaveGlobal } from '../services/socket.service';

export default function KeyRotationSettings() {
  const [nodos, setNodos] = useState([]);
  const [infoClaves, setInfoClaves] = useState({}); // { device_id: { claveActual, ultimaActividad } }

  useEffect(() => {
    getNodes().then(setNodos);
  }, []);

  const cargarInfoClave = async (deviceId) => {
    const info = await getKeyInfo(deviceId);
    setInfoClaves((prev) => ({ ...prev, [deviceId]: info }));
  };

  const handleRotarNodo = async (deviceId) => {
    await rotateKey(deviceId);
    cargarInfoClave(deviceId);
  };

  return (
    <div>
      <h1>Configuración de rotación de claves</h1>

      <section>
        <h2>Rotación global</h2>
        <p>Rota la clave activa de todos los nodos conectados (equivalente al botón del dashboard).</p>
        <button onClick={rotarClaveGlobal}>Rotar clave global ahora</button>
      </section>

      <section>
        <h2>Rotación por nodo</h2>
        <table>
          <thead>
            <tr>
              <th>Device ID</th>
              <th>Clave actual</th>
              <th>Última actividad</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {nodos.map((n) => (
              <tr key={n.device_id} onMouseEnter={() => !infoClaves[n.device_id] && cargarInfoClave(n.device_id)}>
                <td>{n.device_id}</td>
                <td><code>{infoClaves[n.device_id]?.claveActual ?? '••••••••'}</code></td>
                <td>
                  {infoClaves[n.device_id]?.ultimaActividad
                    ? new Date(infoClaves[n.device_id].ultimaActividad).toLocaleString()
                    : new Date(n.ultima_actividad).toLocaleString()}
                </td>
                <td>
                  <button onClick={() => handleRotarNodo(n.device_id)}>Rotar clave ahora</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
