const CurrencypairService = require("../service/currencyPair.service");
const logger = require("../config/logger");

const createCurrencyPairController = async (req, res) => {
    try {
        const pair = await CurrencypairService.createCurrencyPair(req.body);
        res.status(201).json({
            message: "Currency pair created successfully",
            data: pair,
        });
    } catch (err) {
        logger.error("Error creating currency pair:", err);
        res.status(500).json({ error: "Failed to create currency pair" });
    }
};

const getAllCurrencyPairsController = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "" } = req.query;
        const result = await CurrencypairService.getAllCurrencyPairs(Number(page), Number(limit), search);
        res.status(200).json({
            message: "Currency pairs fetched successfully",
            data: result.data,
            pagination: result.pagination,
        });
    } catch (err) {
        logger.error("Error fetching currency pairs:", err);
        res.status(500).json({ error: "Failed to fetch currency pairs" });
    }
};

const updateCurrencyPairController = async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await CurrencypairService.updateCurrencyPair(id, req.body);
        res.status(200).json({
            message: "Currency pair updated successfully",
            data: updated,
        });
    } catch (err) {
        logger.error("Error updating currency pair:", err);
        res.status(500).json({ error: "Failed to update currency pair" });
    }
};

const deleteCurrencyPairController = async (req, res) => {
    try {
        const { id } = req.params;
        await CurrencypairService.deleteCurrencyPair(id);
        res.status(200).json({
            message: "Currency pair deleted successfully",
        });
    } catch (err) {
        logger.error("Error deleting currency pair:", err);
        res.status(500).json({ error: "Failed to delete currency pair" });
    }
};

module.exports = {
    createCurrencyPairController,
    getAllCurrencyPairsController,
    updateCurrencyPairController,
    deleteCurrencyPairController,
};
