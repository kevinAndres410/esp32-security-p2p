const jwt = require('jsonwebtoken');

function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto_dev');
    req.usuario = decoded;
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
}

function soloAvanzado(req, res, next) {
  if (req.usuario.rol !== 'avanzado') {
    return res.status(403).json({ error: 'Acceso restringido a usuarios avanzados' });
  }
  next();
}

module.exports = { verificarToken, soloAvanzado };