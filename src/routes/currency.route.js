const express = require("express");
const router = express.Router();
const {
  createCurrencyController,
  getAllCurrenciesController,
  getCurrencyByIdController,
  updateCurrencyController,
  deleteCurrencyController,
} = require("../controller/currency.controller");

router.post("/", createCurrencyController);
router.get("/", getAllCurrenciesController);
router.get("/:id", getCurrencyByIdController);
router.put("/:id", updateCurrencyController);
router.delete("/:id", deleteCurrencyController);

module.exports = router;
