const express = require('express');
const gatewayController = require('../controllers/gateway.controller');
const { verificarAutenticacionNodo } = require('../middleware/authMiddleware');
const gatewayConfig = require('../services/gatewayConfig.service');

const router = express.Router();
router.post('/sync', verificarAutenticacionNodo, gatewayController.sync);
router.get('/config', gatewayConfig.fetchConfig);
router.post('/config/ack', gatewayConfig.acknowledgeConfig);

module.exports = router;
