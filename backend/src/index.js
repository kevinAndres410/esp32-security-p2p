const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();

const authRoutes = require('./routes/authRoutes');
const nodesRoutes = require('./routes/nodes.routes');
const eventsRoutes = require('./routes/events.routes');
const keysRoutes = require('./routes/keys.routes');
const { verificarToken } = require('./middleware/authMiddleware');
const { initSocket } = require('./websocket/socket');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);

// Rutas Sprint 3, protegidas con el login existente (requieren Bearer token)
app.use('/api/nodes', verificarToken, nodesRoutes);
app.use('/api/events', verificarToken, eventsRoutes);
app.use('/api/keys', verificarToken, keysRoutes);

app.get('/api/health', (req, res) => {
  res.json({ estado: 'ok', mensaje: 'Servidor funcionando correctamente' });
});

initSocket(server);

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Se exportan ambos: "app" para pruebas con supertest (HTTP puro) y
// "server" para poder cerrarlo (server.close()) al final de las pruebas
// de integración que usan sockets reales.
module.exports = { app, server };
