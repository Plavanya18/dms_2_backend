const logger = require("../config/logger");
const reconciliationService = require("../service/reconciliation.service");

const createReconciliation = async (req, res) => {
    try {
        const userId = req.user;
        const data = req.body;
        const rec = await reconciliationService.createReconciliation(data, userId);
        return res.json({ message: "Reconciliation created successfully", data: rec });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

const getAllReconciliations = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      dateFilter = "today",
      startDate,
      endDate,
      status,
      format,
    } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);

    const result = await reconciliationService.getAllReconciliations({
      page: pageNum,
      limit: limitNum,
      dateFilter,
      startDate,
      endDate,
      status,
      format,
    });

    if (result.filePath) {
      return res.status(200).json({
        message: "File generated successfully",
        downloadUrl: `/download-temp-file?path=${encodeURIComponent(result.filePath)}`,
      });
    }

    return res.json({
      message: "Reconciliations fetched successfully",
      data: result.data,
      pagination: {
        total: result.total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(result.total / limitNum),
      },
    });
  } catch (err) {
    logger.error("Failed to fetch reconciliations:", err);
    return res.status(500).json({ message: err.message });
  }
};

const fetchReconciliationAlerts = async (req, res) => {
  try {
    const alerts = await reconciliationService.getReconciliationAlerts();

    return res.status(200).json({
      success: true,
      alerts,
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reconciliation alerts",
    });
  }
};

const getReconciliationById = async (req, res) => {
    try {
        const { id } = req.params;
        const rec = await reconciliationService.getReconciliationById(id);
        return res.json({ message: "Reconciliation fetched successfully", data: rec });
    } catch (err) {
        return res.status(404).json({ message: err.message });
    }
};

const updateReconciliationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { openingEntries, closingEntries, notes } = req.body;
    const userId = req.user; 
    
    if (!openingEntries?.length || !closingEntries?.length) {
      return res.status(400).json({
        message: "Opening and closing entries are required",
      });
    }

    const updatedReconciliation = await reconciliationService.updateReconciliationStatus(
      id,
      { openingEntries, closingEntries, notes },
      userId
    );

    if (!updatedReconciliation) {
      return res.status(404).json({
        message: "No non-tallied reconciliation found for today",
      });
    }

    return res.json({
      message: "Reconciliation updated successfully",
      data: updatedReconciliation,
    });
  } catch (err) {
    console.error("Error updating reconciliation:", err);
    return res.status(500).json({ message: err.message });
  }
};


module.exports = {
    createReconciliation,
    getAllReconciliations,
    fetchReconciliationAlerts,
    getReconciliationById,
    updateReconciliationStatus,
};
