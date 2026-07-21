const express = require('express');
const router = express.Router();
const keysController = require('../controllers/keys.controller');

router.get('/:deviceId', keysController.getKeyInfo);
router.post('/:deviceId/rotate', keysController.rotateKey);

module.exports = router;
