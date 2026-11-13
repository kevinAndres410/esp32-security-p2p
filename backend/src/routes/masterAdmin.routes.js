const express = require('express');
const controller = require('../controllers/masterAdmin.controller');
const operations = require('../controllers/adminOperations.controller');
const { verificarToken, soloAdministrador } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(verificarToken, soloAdministrador);

router.get('/wifi', controller.getWifi);
router.get('/wifi/networks', controller.listWifiNetworks);
router.put('/wifi', controller.saveWifi);
router.post('/wifi/test', controller.testWifi);
router.post('/wifi/apply', controller.applyWifi);
router.post('/kits/:id/wifi/apply', controller.applyKitWifi);

router.get('/kits', controller.listAdminKits);
router.post('/kits', controller.createAdminKit);
router.get('/kits/:id', controller.getAdminKit);
router.patch('/kits/:id', controller.updateAdminKit);
router.delete('/kits/:id', controller.deleteAdminKit);
router.patch('/kits/:id/owner', operations.assignKit);

router.get('/users', operations.listUsers);
router.patch('/users/:id', operations.updateUser);
router.get('/access-requests', operations.listAccessRequests);
router.post('/access-requests/:id/decision', operations.decideAccess);
router.get('/device-requests', operations.listDeviceRequests);
router.get('/monitoring', operations.getMonitoring);
router.get('/audit', operations.listAudit);
router.get('/settings', operations.getSettings);
router.put('/settings', operations.updateSettings);
router.get('/health', operations.getHealth);
router.get('/backup', operations.downloadBackup);
router.post('/backup/restore', express.raw({ type: 'application/octet-stream', limit: '32mb' }), operations.restoreBackup);

module.exports = router;
