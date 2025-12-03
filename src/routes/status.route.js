const express = require("express");
const router = express.Router();
const controller = require("../controller/status.controller");

router.post("/deal", controller.createDealStatus);
router.put("/deal/:id", controller.updateDealStatus);
router.get("/deal/:id", controller.getDealStatusById);
router.get("/deal", controller.getDealStatusList);
router.delete("/deal/:id", controller.deleteDealStatus);
router.post("/reconciliation", controller.createreconciliationStatus);
router.put("/reconciliation/:id", controller.updatereconciliationStatus);
router.get("/reconciliation/:id", controller.getreconciliationStatusById);
router.get("/reconciliation", controller.getreconciliationStatusList);
router.delete("/reconciliation/:id", controller.deletereconciliationStatus);

module.exports = router;
