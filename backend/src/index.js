const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();

if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || !process.env.MASTER_ENCRYPTION_KEY) {
    throw new Error('JWT_SECRET y MASTER_ENCRYPTION_KEY son obligatorios en producción');
  }
  if (process.env.WIFI_PROVISIONING_URL &&
      (!process.env.WIFI_PROVISIONING_URL.startsWith('https://') || !process.env.WIFI_PROVISIONING_SECRET)) {
    throw new Error('El adaptador Wi-Fi requiere HTTPS y WIFI_PROVISIONING_SECRET en producción');
  }
}

const authRoutes = require('./routes/authRoutes');
const nodesRoutes = require('./routes/nodes.routes');
const eventsRoutes = require('./routes/events.routes');
const keysRoutes = require('./routes/keys.routes');
const gatewayRoutes = require('./routes/gateway.routes');
const kitsRoutes = require('./routes/kits.routes');
const masterAdminRoutes = require('./routes/masterAdmin.routes');
const { verificarToken } = require('./middleware/authMiddleware');
const { initSocket } = require('./websocket/socket');
const { applyRotationSchedule } = require('./services/rotationScheduler.service');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',') }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/gateway', gatewayRoutes);
app.use('/api/kits', kitsRoutes);
app.use('/api/master-admin', masterAdminRoutes);

// Rutas Sprint 3, protegidas con el login existente (requieren Bearer token)
app.use('/api/nodes', verificarToken, nodesRoutes);
app.use('/api/events', verificarToken, eventsRoutes);
app.use('/api/keys', verificarToken, keysRoutes);

app.get('/api/health', (req, res) => {
  res.json({ estado: 'ok', mensaje: 'Servidor funcionando correctamente' });
});

initSocket(server);

applyRotationSchedule();

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Se exportan ambos: "app" para pruebas con supertest (HTTP puro) y
// "server" para poder cerrarlo (server.close()) al final de las pruebas
// de integración que usan sockets reales.
module.exports = { app, server };
