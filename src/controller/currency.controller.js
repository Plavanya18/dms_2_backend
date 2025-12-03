const {
  createCurrency,
  getAllCurrencies,
  getCurrencyById,
  updateCurrency,
  deleteCurrency,
} = require("../service/currency.service");

const logger = require("../config/logger");

const createCurrencyController = async (req, res) => {
  try {
    const currency = await createCurrency(req.body);
    res.status(201).json({
      message: "Currency created successfully",
      data: currency,
    });
  } catch (err) {
    logger.error("Error creating currency:", err);
    res.status(500).json({ error: "Failed to create currency" });
  }
};

const getAllCurrenciesController = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", orderBy, direction} = req.query;
    const currencies = await getAllCurrencies(Number(page), Number(limit), search, orderBy, direction);
    res.status(200).json({
      message: "Currencies fetched successfully",
      data: currencies.data,
      pagination: currencies.pagination,
      sort: currencies.sort
    });
  } catch (err) {
    logger.error("Error fetching currencies:", err);
    res.status(500).json({ error: "Failed to fetch currencies" });
  }
};

const getCurrencyByIdController = async (req, res) => {
  try {
    const { id } = req.params;
    const currency = await getCurrencyById(id);
    if (!currency) return res.status(404).json({ error: "Currency not found" });
    res.status(200).json({
      message: "Currency fetched successfully",
      data: currency
    });
  } catch (err) {
    logger.error("Error fetching currency:", err);
    res.status(500).json({ error: "Failed to fetch currency" });
  }
};

const updateCurrencyController = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await updateCurrency(id, req.body);
    res.status(200).json({
      message: "Currency updated successfully",
      data: updated
    });
  } catch (err) {
    logger.error("Error updating currency:", err);
    res.status(500).json({ error: "Failed to update currency" });
  }
};

const deleteCurrencyController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteCurrency(id);
     res.status(200).json({
      message: "Currency deleted successfully",
    });
    } catch (err) {
    logger.error("Error deleting currency:", err);
    res.status(500).json({ error: "Failed to delete currency" });

  }
};

module.exports = {
  createCurrencyController,
  getAllCurrenciesController,
  getCurrencyByIdController,
  updateCurrencyController,
  deleteCurrencyController,
};
