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
    const {
      page = 1,
      limit = 10,
      search = "",
      statusName = "",
      currencyName = "",
      orderByField = "created_at",
      orderDirection = "desc",
      dateFilter = "",
      startDate = "",
      endDate = "",
      format = ""
    } = req.query;

    const result = await dealService.getAllDeals(
      Number(page),
      Number(limit),
      search,
      statusName,
      currencyName,
      orderByField,
      orderDirection,
      dateFilter,
      startDate,
      endDate,
      format
    );

    if (result.filePath) {
      return res.status(200).json({
        message: "File generated successfully",
        downloadUrl: `/download-temp-file?path=${encodeURIComponent(result.filePath)}`
      });
    }

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

const updateDealStatusController = async (req, res) => {
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

const updateDealController = async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;
    const userId = req.user;

    const result = await dealService.updateDeal(id, data, userId);

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
  updateDealStatusController,
  updateDealController,
};
