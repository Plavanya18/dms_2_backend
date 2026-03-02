const OpenSetRateService = require("../service/openSetRate.service");
const logger = require("../config/logger");

const upsertOpenSetRateController = async (req, res) => {
    try {
        const rate = await OpenSetRateService.upsertOpenSetRate(req.body);
        res.status(200).json({
            message: "Rate saved successfully",
            data: rate,
        });
    } catch (err) {
        logger.error("Error upserting OpenSetRate:", err);
        res.status(500).json({ error: "Failed to save rate" });
    }
};

const getOpenSetRatesController = async (req, res) => {
    try {
        const { date = new Date() } = req.query;
        const result = await OpenSetRateService.getOpenSetRates(date);
        res.status(200).json({
            message: "Rates fetched successfully",
            data: result.rates,
            previousRate: result.previousRate,
        });
    } catch (err) {
        logger.error("Error fetching OpenSetRates:", err);
        res.status(500).json({ error: "Failed to fetch rates" });
    }
};

module.exports = {
    upsertOpenSetRateController,
    getOpenSetRatesController,
};
