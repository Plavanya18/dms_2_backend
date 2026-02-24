const express = require("express");
const router = express.Router();
const {
    createCurrencyPairController,
    getAllCurrencyPairsController,
    updateCurrencyPairController,
    deleteCurrencyPairController,
} = require("../controller/currencyPair.controller");

router.post("/", createCurrencyPairController);
router.get("/", getAllCurrencyPairsController);
router.put("/:id", updateCurrencyPairController);
router.delete("/:id", deleteCurrencyPairController);

module.exports = router;
