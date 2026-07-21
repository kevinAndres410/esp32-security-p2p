import { useEffect, useState } from 'react';
import { getEvents } from '../services/events.service';
import { subscribe } from '../services/socket.service';

export default function AlertsEvents() {
  const [eventos, setEventos] = useState([]);
  const [tipo, setTipo] = useState('');

  const cargarEventos = async (filtros) => setEventos(await getEvents(filtros));

  useEffect(() => {
    cargarEventos(tipo ? { tipo } : {});
    const unsub = subscribe('alerta_nueva', () => cargarEventos(tipo ? { tipo } : {}));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  return (
    <div>
      <h1>Alertas y eventos</h1>

      <label>
        Filtrar por tipo:
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos</option>
          <option value="conexion">Conexión</option>
          <option value="bloqueo">Bloqueo</option>
          <option value="eliminacion">Eliminación</option>
          <option value="rotacion">Rotación de clave</option>
          <option value="auth_failure">Fallo de autenticación</option>
        </select>
      </label>

      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Nodo</th>
            <th>Tipo</th>
            <th>Mensaje</th>
          </tr>
        </thead>
        <tbody>
          {eventos.map((ev) => (
            <tr key={ev.id}>
              <td>{new Date(ev.creado_en).toLocaleString()}</td>
              <td>{ev.nodo_id || '-'}</td>
              <td>{ev.tipo}</td>
              <td>{ev.mensaje}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
