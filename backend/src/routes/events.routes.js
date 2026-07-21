const express = require('express');
const router = express.Router();
const eventsController = require('../controllers/events.controller');

router.get('/', eventsController.listEvents);
router.get('/:id', eventsController.getEvent);

module.exports = router;
