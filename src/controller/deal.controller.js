const dealService = require("../service/deal.service");

const createDealController = async (req, res) => {
  try {
    const data = req.body;
    const userId = req.user
    const result = await dealService.createDeal(data, userId);

    return res.status(201).json({
      message: "Deal created successfully",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Failed to create Deal",
    });
  }
};

const listDealController = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search || "";
    const statusName = req.query.statusName || "";
    const currencyName = req.query.currencyName || "";
    const orderByField = req.query.orderByField || "created_at";
    const orderDirection = req.query.orderDirection || "desc";

    const result = await dealService.getAllDeals(page, limit, search, statusName, currencyName, orderByField, orderDirection);

    return res.status(200).json({
      message: "Deal list fetched successfully",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to fetch Deal list",
    });
  }
};

const getDealControllerById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await dealService.getDealById(Number(id));

    if (!result) {
      return res.status(404).json({ message: "Deal not found" });
    }

    return res.status(200).json({
      message: "Deal fetched successfully",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Unable to fetch Deal",
    });
  }
};

const updateDealController = async (req, res) => {
  try {
    const { id } = req.params;
    const { status_id, reason } = req.body;
    const data = { status_id, reason };
    const userId = req.user

    const result = await dealService.updateDealStatus(Number(id), Number(status_id), reason, Number(userId));

    return res.status(200).json({
      message: "Deal updated successfully",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Failed to update Deal",
    });
  }
};

module.exports = {
  createDealController,
  listDealController,
  getDealControllerById,
  updateDealController,
};
