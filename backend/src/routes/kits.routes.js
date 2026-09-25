const express = require('express');
const c = require('../controllers/kits.controller');
const { verificarToken } = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/discovery', c.reportCandidate);
router.use(verificarToken);
router.get('/', c.listKits);
router.post('/claim', c.claimKit);
router.post('/:kitId/scans', c.startScan);
router.get('/:kitId/candidates', c.listCandidates);
router.get('/:kitId/inventory', c.listInventory);
router.post('/:kitId/requests', c.createRequest);
router.get('/requests/all', c.listRequests);
router.post('/requests/:id/:action', c.decide);

module.exports = router;
