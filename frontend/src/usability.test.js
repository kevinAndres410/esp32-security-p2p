import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import App from './App';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NodesManagement from './pages/NodesManagement';
import AlertsEvents from './pages/AlertsEvents';
import KeyRotationSettings from './pages/KeyRotationSettings';
import { getNodes, registerNode, blockNode } from './services/nodes.service';
import { getEvents } from './services/events.service';
import { rotateKey } from './services/keys.service';
import { subscribe } from './services/socket.service';

jest.mock('axios');
jest.mock('./services/socket.service', () => ({
  connectSocket: jest.fn(),
  disconnectSocket: jest.fn(),
  subscribe: jest.fn(() => () => {}),
}));
jest.mock('./services/nodes.service', () => ({
  getNodes: jest.fn(),
  registerNode: jest.fn(),
  blockNode: jest.fn(),
  unblockNode: jest.fn(),
  deleteNode: jest.fn(),
}));
jest.mock('./services/events.service', () => ({ getEvents: jest.fn() }));
jest.mock('./services/keys.service', () => ({
  getKeyInfo: jest.fn(),
  rotateAllKeys: jest.fn(),
  rotateKey: jest.fn(),
}));

const physicalNode = {
  device_id: 'esp32-001',
  mac_address: '20:50:0D:17:C8:D0',
  descripcion: 'Nodo físico 1',
  estado: 'activo',
  ultima_actividad: new Date().toISOString(),
};

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  getNodes.mockResolvedValue([physicalNode]);
  getEvents.mockResolvedValue([]);
  subscribe.mockReturnValue(() => {});
});

test('tarea 1: inicia sesión con campos accesibles y confirma el acceso', async () => {
  axios.post.mockResolvedValue({ data: { token: 'token-prueba', usuario: { email: 'admin@example.com', rol: 'avanzado' } } });
  const onLogin = jest.fn();
  render(<Login onLogin={onLogin} onRegister={() => {}} />);

  fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: 'admin@example.com' } });
  fireEvent.change(screen.getByLabelText(/^contraseña/i), { target: { value: 'segura123' } });
  fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

  await waitFor(() => expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ rol: 'avanzado' })));
});

test('tareas 2 y 4: registra por MAC y permite bloquear el nodo correcto', async () => {
  registerNode.mockResolvedValue({ claveActual: 'clave-generada' });
  blockNode.mockResolvedValue({ estado: 'bloqueado' });
  render(<NodesManagement />);

  await screen.findByText('20:50:0D:17:C8:D0');
  fireEvent.change(screen.getByLabelText(/device id/i), { target: { value: 'esp32-004' } });
  fireEvent.change(screen.getByLabelText(/dirección mac/i), { target: { value: 'AA:BB:CC:DD:EE:FF' } });
  fireEvent.change(screen.getByLabelText(/descripción/i), { target: { value: 'Nodo de prueba' } });
  fireEvent.click(screen.getByRole('button', { name: /registrar/i }));

  await waitFor(() => expect(registerNode).toHaveBeenCalledWith({
    deviceId: 'esp32-004', macAddress: 'AA:BB:CC:DD:EE:FF', descripcion: 'Nodo de prueba',
  }));
  fireEvent.click(screen.getByRole('button', { name: /bloquear/i }));
  await waitFor(() => expect(blockNode).toHaveBeenCalledWith('esp32-001'));
});

test('tarea 3: distingue un nodo activo de uno inactivo', () => {
  subscribe.mockImplementation((event, callback) => {
    if (event === 'estado_red') callback({
      nodos: [physicalNode, { ...physicalNode, device_id: 'esp32-002', estado: 'pendiente' }],
      gateway: { device_id: 'gateway-001', mac_address: 'B0:3F:D3:5B:50:B4', estado: 'activo' },
      eventos: [],
    });
    return () => {};
  });
  render(<Dashboard usuario={{ nombre: 'Operador' }} onNavigate={() => {}} isAdvanced />);

  expect(screen.getByText('1', { selector: '.metric-value' })).toBeInTheDocument();
  expect(screen.getAllByText('Activo').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Pendiente')).toBeInTheDocument();
  expect(screen.getByText('B0:3F:D3:5B:50:B4')).toBeInTheDocument();
});

test('tarea 5: muestra el evento reciente junto con su nodo', async () => {
  getEvents.mockResolvedValue([{
    id: 1,
    tipo: 'auth_failure',
    nodo_id: 'esp32-001',
    mensaje: 'Firma inválida detectada',
    creado_en: new Date().toISOString(),
  }]);
  render(<AlertsEvents />);

  expect(await screen.findByText('Firma inválida detectada')).toBeInTheDocument();
  expect(screen.getByText('esp32-001')).toBeInTheDocument();
});

test('Tabla 8A XSS: un marcador HTML en el mensaje se muestra como texto', async () => {
  const marker = '<img src=x onerror=alert(1)>';
  getEvents.mockResolvedValue([{
    id: 2, tipo: 'auth_failure', nodo_id: 'esp32-001',
    mensaje: marker, creado_en: new Date().toISOString(),
  }]);
  const { container } = render(<AlertsEvents />);
  expect(await screen.findByText(marker)).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
});

test('tarea 6: rota la clave del nodo seleccionado y confirma la acción', async () => {
  rotateKey.mockResolvedValue({ ok: true });
  render(<KeyRotationSettings />);

  const rotateButton = await screen.findByRole('button', { name: /rotar clave ↻/i });
  fireEvent.click(rotateButton);
  await waitFor(() => expect(rotateKey).toHaveBeenCalledWith('esp32-001'));
  expect(await screen.findByText(/rotada correctamente/i)).toBeInTheDocument();
});

test('tarea 7: cerrar sesión elimina la sesión local y vuelve al login', () => {
  localStorage.setItem('token', 'token-prueba');
  localStorage.setItem('usuario', JSON.stringify({ email: 'admin@example.com', rol: 'avanzado' }));
  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));
  expect(screen.getByRole('heading', { name: /bienvenido de nuevo/i })).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBeNull();
});
