import React, { useState } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NodesManagement from './pages/NodesManagement';
import AlertsEvents from './pages/AlertsEvents';
import KeyRotationSettings from './pages/KeyRotationSettings';
import './App.css';

function App() {
  const [usuario, setUsuario] = useState(null);
  const [vista, setVista] = useState('dashboard');

  const handleLogin = (data) => setUsuario(data);
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    setUsuario(null);
  };

  if (!usuario) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="App">
      <nav>
        <button onClick={() => setVista('dashboard')}>Dashboard</button>
        <button onClick={() => setVista('nodos')}>Gestión de nodos</button>
        <button onClick={() => setVista('alertas')}>Alertas y eventos</button>
        <button onClick={() => setVista('claves')}>Rotación de claves</button>
        <button onClick={handleLogout}>Cerrar sesión</button>
      </nav>

      {vista === 'dashboard' && <Dashboard usuario={usuario} onLogout={handleLogout} />}
      {vista === 'nodos' && <NodesManagement />}
      {vista === 'alertas' && <AlertsEvents />}
      {vista === 'claves' && <KeyRotationSettings />}
    </div>
  );
}

export default App;
