const express = require('express');
const gatewayController = require('../controllers/gateway.controller');
const { verificarAutenticacionNodo } = require('../middleware/authMiddleware');

const router = express.Router();
router.post('/sync', verificarAutenticacionNodo, gatewayController.sync);

module.exports = router;
