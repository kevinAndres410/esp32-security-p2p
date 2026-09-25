const express = require('express');
const router = express.Router();
const keysController = require('../controllers/keys.controller');
const { soloAvanzado } = require('../middleware/authMiddleware');

router.use(soloAvanzado);
router.post('/rotate-all', keysController.rotateAllKeys);
router.get('/:deviceId', keysController.getKeyInfo);
router.post('/:deviceId/rotate', keysController.rotateKey);

module.exports = router;
