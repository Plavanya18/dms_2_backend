const express = require("express");
const router = express.Router();
const dealController = require("../controller/deal.controller");

router.post("/", dealController.createDealController);
router.get("/", dealController.listDealController);
router.get("/:id", dealController.getDealControllerById);
router.put("/:id", dealController.updateDealController);

module.exports = router;
