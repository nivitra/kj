const express = require('express');
const { authenticateCustomer } = require('../middleware/auth');
const { ok, fail } = require('../lib/envelope');
const { CODES } = require('../lib/errors');
const workflow = require('../services/selectionWorkflow');
const router = express.Router();
router.use(authenticateCustomer);
const args = (req) => ({ studioId: req.customer.studioId, customerId: req.customer.id, galleryId: req.params.galleryId });
const handle = (fn) => async (req, res) => {
  try { return ok(res, await fn(req)); }
  catch (e) { return fail(res, CODES.VALIDATION, e.message, { status: e.status || 400 }); }
};
router.get('/my/:galleryId', handle((req) => workflow.getSelection(args(req))));
router.get('/my/:galleryId/items', handle((req) => workflow.getSelection(args(req), true)));
router.post('/my/:galleryId/preview', handle((req) => workflow.getSelection(args(req))));
router.post('/my/:galleryId/submit', handle((req) => workflow.submitSelection({ ...args(req), note: String(req.body?.note || '').slice(0, 2000), revision: req.body?.revision })));
module.exports = router;
