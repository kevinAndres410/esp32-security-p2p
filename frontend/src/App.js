import { useEffect, useState } from 'react';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NodesManagement from './pages/NodesManagement';
import AlertsEvents from './pages/AlertsEvents';
import KeyRotationSettings from './pages/KeyRotationSettings';
import DeviceAdministration from './pages/DeviceAdministration';
import KitDevices from './pages/KitDevices';
import MasterAdmin from './pages/MasterAdmin';
import { requestAdvancedAccess } from './services/access.service';
import { connectSocket, disconnectSocket } from './services/socket.service';
import './App.css';

const technicalViews = [
  ['nodos', 'Registro de nodos'],
  ['claves', 'Rotación de claves'],
  ['dispositivos', 'Administración de dispositivos'],
];

function getStoredUser() {
  try {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('usuario');
    return token && user ? JSON.parse(user) : null;
  } catch {
    return null;
  }
}
export default function App() {
  const [usuario, setUsuario] = useState(getStoredUser);
  const [vista, setVista] = useState('dashboard');
  const [authView, setAuthView] = useState('login');
  const [authMessage, setAuthMessage] = useState('');
  const [technicalMenu, setTechnicalMenu] = useState(false);
  const [accessModal, setAccessModal] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState('');
  const isAdvanced = usuario?.rol === 'avanzado' || usuario?.rol === 'master_admin';
  const isMaster = usuario?.rol === 'master_admin';
  const availableTechnicalViews = isMaster
    ? [...technicalViews, ['master-admin', 'Administrador Maestro']]
    : technicalViews;

  useEffect(() => {
    if (usuario) connectSocket();
    else disconnectSocket();
  }, [usuario]);

  useEffect(() => {
    const invalidateSession = () => {
      localStorage.removeItem('token');
      localStorage.removeItem('usuario');
      setUsuario(null);
      setVista('dashboard');
      setAuthView('login');
      setAuthMessage('Tu sesión cambió. Inicia sesión de nuevo.');
    };
    window.addEventListener('securemesh:session-invalid', invalidateSession);
    return () => window.removeEventListener('securemesh:session-invalid', invalidateSession);
  }, []);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    setUsuario(null);
    setVista('dashboard');
    setAuthView('login');
  };

  const navigate = (view) => {
    if (view === 'master-admin' && !isMaster) return;
    if (technicalViews.some(([id]) => id === view) && !isAdvanced) {
      setAccessModal(true);
      setTechnicalMenu(false);
      return;
    }
    setVista(view);
    setTechnicalMenu(false);
  };

  const requestAccess = async () => {
    setAccessBusy(true); setAccessError('');
    try {
      const response = await requestAdvancedAccess();
      const updatedUser = { ...usuario, estadoAccesoAvanzado: response.estadoAccesoAvanzado };
      setUsuario(updatedUser);
      localStorage.setItem('usuario', JSON.stringify(updatedUser));
    } catch (error) { setAccessError(error.message); }
    finally { setAccessBusy(false); }
  };

  if (!usuario) {
    if (authView === 'register') return <Register onBack={() => setAuthView('login')} onSuccess={(message) => { setAuthMessage(message); setAuthView('login'); }} />;
    return <Login onLogin={setUsuario} onRegister={() => setAuthView('register')} message={authMessage} />;
  }

  return (
    <div className="app-shell">
      <nav className="topbar" aria-label="Navegación principal">
        <button className="brand" onClick={() => setVista('dashboard')} aria-label="Ir al inicio">
          <span className="brand-mark">S</span><span>SecureMesh</span>
        </button>
        <div className="nav-links">
          <button className={vista === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')}>Inicio</button>
          <button className={vista === 'alertas' ? 'active' : ''} onClick={() => navigate('alertas')}>Alertas y eventos</button>
          <button className={vista === 'kit' ? 'active' : ''} onClick={() => navigate('kit')}>Mis dispositivos</button>
          <div className={`technical-nav ${availableTechnicalViews.some(([id]) => id === vista) ? 'active' : ''}`}>
            <button className="technical-trigger" aria-expanded={technicalMenu} onClick={() => isAdvanced ? setTechnicalMenu((open) => !open) : setAccessModal(true)}>Zona Técnica <span>{isAdvanced ? '⌄' : '⌕'}</span></button>
            {isAdvanced && technicalMenu && <div className="technical-menu">{availableTechnicalViews.map(([id, label]) => <button key={id} onClick={() => navigate(id)}>{label}</button>)}</div>}
          </div>
          <button className="logout-link" onClick={logout}>Cerrar sesión</button>
        </div>
      </nav>
      {vista === 'dashboard' && <Dashboard usuario={usuario} onNavigate={navigate} isAdvanced={isAdvanced} />}
      {vista === 'kit' && <KitDevices isAdvanced={isAdvanced} />}
      {vista === 'nodos' && isAdvanced && <NodesManagement />}
      {vista === 'alertas' && <AlertsEvents />}
      {vista === 'claves' && isAdvanced && <KeyRotationSettings />}
      {vista === 'dispositivos' && isAdvanced && <DeviceAdministration onNavigate={navigate} />}
      {vista === 'master-admin' && isMaster && <MasterAdmin usuario={usuario} onRestored={() => { logout(); setAuthMessage('Copia restaurada. Inicia sesión de nuevo.'); }} />}
      {accessModal && <AccessModal status={usuario.estadoAccesoAvanzado} busy={accessBusy} error={accessError} onClose={() => setAccessModal(false)} onRequest={requestAccess} />}
    </div>
  );
}

function AccessModal({ status, busy, error, onClose, onRequest }) {
  const pending = status === 'pending';
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal access-modal" role="dialog" aria-modal="true" aria-labelledby="access-title"><div className="rotation-icon">!</div><p className="eyebrow">ACCESO RESTRINGIDO</p><h2 id="access-title">Zona Técnica</h2><p>Atención: Para acceder a esta sección se requieren conocimientos técnicos avanzados. Si decides ingresar, será bajo tu propio riesgo ya que podrías alterar la configuración del sistema. ¿Deseas solicitar acceso avanzado?</p>{error && <p className="feedback error">{error}</p>}{pending && <p className="pending-notice">Tu solicitud está pendiente de revisión.</p>}<div className="modal-actions"><button className="ghost-button" onClick={onClose}>Cerrar</button><button className="primary-button" onClick={onRequest} disabled={pending || busy}>{busy ? 'Enviando…' : pending ? 'Solicitud pendiente' : 'Solicitar acceso avanzado'}</button></div></section></div>;
}
