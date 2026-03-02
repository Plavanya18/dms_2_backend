const express = require("express");
const router = express.Router();
const {
    upsertOpenSetRateController,
    getOpenSetRatesController,
} = require("../controller/openSetRate.controller");

router.post("/", upsertOpenSetRateController);
router.get("/", getOpenSetRatesController);

module.exports = router;
