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
        } = req.query;

        const pageNum = Number(page);
        const limitNum = Number(limit);

        const recs = await reconciliationService.getAllReconciliations({
            page: pageNum,
            limit: limitNum,
            dateFilter,
            startDate,
            endDate,
            status,
        });

        return res.json({
            message: "Reconciliations fetched successfully",
            data: recs.data,
            pagination: {
                total: recs.total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(recs.total / limitNum),
            },
        });
    } catch (err) {
        logger.error("Failed to fetch reconciliations:", err);
        return res.status(500).json({ message: err.message });
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
        const { status, notes } = req.body;
        const userId = req.user;
        const rec = await reconciliationService.updateReconciliationStatus(
            id,
            status,
            notes,
            userId
        );
        return res.json({ message: "Reconciliation updated successfully", data: rec });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
};

module.exports = {
    createReconciliation,
    getAllReconciliations,
    getReconciliationById,
    updateReconciliationStatus,
};
