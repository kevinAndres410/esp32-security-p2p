const express = require('express');
const router = express.Router();
const { register, login, requestAdvancedAccess } = require('../controllers/authController');
const { verificarToken } = require('../middleware/authMiddleware');

router.post('/register', register);
router.post('/login', login);
router.post('/access-request', verificarToken, requestAdvancedAccess);

module.exports = router;
