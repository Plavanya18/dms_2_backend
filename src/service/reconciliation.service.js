const { getdb } = require("../config/db");
const logger = require("../config/logger");

const createReconciliation = async (data, userId) => {
    try {
        const totalOpening = data.openingEntries.reduce(
            (sum, entry) => sum + Number(entry.amount),
            0
        );
        const totalClosing = data.closingEntries.reduce(
            (sum, entry) => sum + Number(entry.amount),
            0
        );

        let status;
        if (totalClosing === totalOpening) status = "Tallied";
        else if (totalClosing < totalOpening) status = "Short";
        else status = "Excess";

        const newReconciliation = await getdb.reconciliation.create({
            data: {
                status,
                created_by: userId,
                created_at: new Date(),
                updated_at: new Date(),
                openingEntries: {
                    create: data.openingEntries.map((entry) => ({
                        denomination: entry.denomination,
                        quantity: entry.quantity,
                        amount: entry.amount,
                        currency_id: entry.currency_id,
                    })),
                },
                closingEntries: {
                    create: data.closingEntries.map((entry) => ({
                        denomination: entry.denomination,
                        quantity: entry.quantity,
                        amount: entry.amount,
                        currency_id: entry.currency_id,
                    })),
                },
                notes: data.notes
                    ? {
                        create: data.notes.map((note) => ({ note })),
                    }
                    : undefined,
            },
            include: {
                openingEntries: { include:{ currency: { select: { id: true, code: true, name: true } } } },
                closingEntries: { include:{ currency: { select: { id: true, code: true, name: true } } } },
                notes: true,
                createdBy: { select: { id: true, full_name: true, email: true } },
            },
        });

        return newReconciliation;
    } catch (error) {
        logger.error("Failed to create reconciliation:", error);
        throw error;
    }
};

const getAllReconciliations = async () => {
    try {
        const reconciliations = await getdb.reconciliation.findMany({
            include: {
                openingEntries: { include:{ currency: { select: { id: true, code: true, name: true } } } },
                closingEntries: { include:{ currency: { select: { id: true, code: true, name: true } } } },
                notes: true,
                createdBy: { select: { id: true, full_name: true, email: true } },
            },
            orderBy: { created_at: "desc" },
        });

        return reconciliations;

    } catch (error) {
        logger.error("Failed to fetch reconciliations:", error);
        throw error;
    }
};

const getReconciliationById = async (id) => {
    try {
        const rec = await getdb.reconciliation.findUnique({
            where: { id: Number(id) },
            include: {
                openingEntries: { include:{ currency: { select: { id: true, code: true, name: true } } } },
                closingEntries: { include:{ currency: { select: { id: true, code: true, name: true } } } },
                notes: true,
                createdBy: { select: { id: true, full_name: true, email: true } },
            },
        });
        if (!rec) throw new Error("Reconciliation not found");
        return rec;
    } catch (error) {
        logger.error("Failed to fetch reconciliation by ID:", error);
        throw error;
    }
};

const updateReconciliationStatus = async (id, status, notes, userId) => {
    try {
        return await getdb.reconciliation.update({
            where: { id: Number(id) },
            data: {
                status,
                updated_at: new Date(),
                notes: notes
                    ? {
                        create: notes.map((note) => ({ note })),
                    }
                    : undefined,
            },
            include: {
                notes: true,
                createdBy: { select: { id: true, full_name: true, email: true } },
                openingEntries: { include:{ currency: { select: { id: true, code: true, name: true } } } },
                closingEntries: { include:{ currency: { select: { id: true, code: true, name: true } } } },
            },
        });
    } catch (error) {
        logger.error("Failed to update reconciliation status:", error);
        throw error;
    }
};

module.exports = {
    createReconciliation,
    getAllReconciliations,
    getReconciliationById,
    updateReconciliationStatus,
};
