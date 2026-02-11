const express = require("express");
const router = express.Router();
const reconciliationController = require("../controller/reconciliation.controller");

router.post("/", reconciliationController.createReconciliation);
router.get("/", reconciliationController.getAllReconciliations);
router.get("/alerts", reconciliationController.fetchReconciliationAlerts);
router.get("/:id", reconciliationController.getReconciliationById);
router.patch("/:id", reconciliationController.updateReconciliation);
router.post("/:id/start", reconciliationController.startReconciliation);

module.exports = router;
