import React, { useState } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

function App() {
  const [usuario, setUsuario] = useState(null);

  const handleLogin = (data) => setUsuario(data);
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    setUsuario(null);
  };

  return usuario
    ? <Dashboard usuario={usuario} onLogout={handleLogout} />
    : <Login onLogin={handleLogin} />;
}

export default App;