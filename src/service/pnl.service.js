const { getdb } = require("../config/db");
const logger = require("../config/logger");

/**
 * Get P&L Overview statistics
 * @returns {Promise<Object>}
 */
const getPnLOverview = async () => {
    try {
        const reconciliations = await getdb.reconciliation.findMany({
            include: {
                openingEntries: { include: { currency: true } },
                closingEntries: { include: { currency: true } },
                deals: {
                    include: {
                        deal: {
                            include: {
                                buyCurrency: true,
                                sellCurrency: true,
                                receivedItems: true,
                                paidItems: true,
                            },
                        },
                    },
                },
            },
        });

        // In a production environment, we'd reuse the heavy lifting from reconciliation service
        // For now we calculate the aggregate across all records
        return {
            totalPnL: reconciliations.reduce((sum, r) => sum + Number(r.profitLoss || 0), 0),
            count: reconciliations.length,
            lastUpdated: reconciliations.length > 0 ? reconciliations[0].updated_at : null
        };
    } catch (error) {
        logger.error("Error in getPnLOverview service:", error);
        throw error;
    }
};

module.exports = {
    getPnLOverview,
};
