const db = require('../models/db');

// GET /api/events?nodeId=&tipo=&limit=
function listEvents(req, res) {
  const { nodeId, tipo, limit = 100 } = req.query;

  let query = `SELECT * FROM eventos WHERE 1=1`;
  const params = [];

  if (nodeId) {
    query += ` AND nodo_id = ?`;
    params.push(nodeId);
  }
  if (tipo) {
    query += ` AND tipo = ?`;
    params.push(tipo);
  }

  query += ` ORDER BY creado_en DESC LIMIT ?`;
  params.push(Number(limit));

  const eventos = db.prepare(query).all(...params);
  res.json(eventos);
}

// GET /api/events/:id
function getEvent(req, res) {
  const evento = db.prepare(`SELECT * FROM eventos WHERE id = ?`).get(req.params.id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(evento);
}

module.exports = { listEvents, getEvent };
