const express = require('express');
const router = express.Router();
const nodesController = require('../controllers/nodes.controller');

router.get('/', nodesController.listNodes);
router.get('/:deviceId', nodesController.getNode);
router.post('/', nodesController.registerNode);
router.patch('/:deviceId/block', nodesController.blockNode);
router.patch('/:deviceId/unblock', nodesController.unblockNode);
router.delete('/:deviceId', nodesController.deleteNode);

module.exports = router;
