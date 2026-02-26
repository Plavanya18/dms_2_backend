const express = require('express');
const pnlController = require('../controller/pnl.controller');

const router = express.Router();

router.get('/overview', pnlController.getPnLOverview);

module.exports = router;
