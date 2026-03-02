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

        const totalGrossPnL = reconciliations.reduce((sum, r) => sum + Number(r.profitLoss || 0), 0);

        // Fetch total expenses
        const totalExpenses = await getdb.expense.aggregate({
            _sum: { amount: true }
        });

        const expenseAmount = Number(totalExpenses._sum.amount || 0);

        return {
            totalGrossPnL,
            totalExpenses: expenseAmount,
            totalNetPnL: totalGrossPnL - expenseAmount,
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
