const express = require('express');
const router = express.Router();
const nodesController = require('../controllers/nodes.controller');
const { soloAvanzado } = require('../middleware/authMiddleware');

router.get('/', nodesController.listNodes);
router.get('/:deviceId', nodesController.getNode);
router.post('/', soloAvanzado, nodesController.registerNode);
router.patch('/:deviceId/block', soloAvanzado, nodesController.blockNode);
router.patch('/:deviceId/unblock', soloAvanzado, nodesController.unblockNode);
router.delete('/:deviceId', soloAvanzado, nodesController.deleteNode);

module.exports = router;
