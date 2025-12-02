const express = require("express");
const router = express.Router();
const {
  createIpController,
  getAllIpsController,
  getIpByIdController,
  updateIpController,
  deleteIpController,
} = require("../controller/ipaddress.controller");

router.post("/", createIpController);
router.get("/", getAllIpsController);
router.get("/:id", getIpByIdController);
router.put("/:id", updateIpController);
router.delete("/:id", deleteIpController);

module.exports = router;
