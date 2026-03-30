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

        const totalGrossPnL = reconciliations.reduce((sum, rec) => {
            let totalTzsPaid = 0;
            let totalForeignBought = 0;

            rec.deals.forEach((rd) => {
                const deal = rd.deal;
                if (!deal) return;

                let foreignAmount = Number(deal.amount || 0);
                let tzsAmount = Number(deal.amount_to_be_paid || 0);

                if (deal.status === "Pending") {
                    foreignAmount = (deal.receivedItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
                    tzsAmount = (deal.paidItems || []).reduce((s, i) => s + Number(i.total || 0), 0);

                    if (deal.deal_type === "sell") {
                        foreignAmount = (deal.paidItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
                        tzsAmount = (deal.receivedItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
                    }
                }

                const buyCode = deal.buyCurrency?.code;
                if (deal.deal_type === "buy" && buyCode !== "TZS") {
                    totalTzsPaid += tzsAmount;
                    totalForeignBought += foreignAmount;
                }
            });

            const valuationRate = totalForeignBought > 0 ? totalTzsPaid / totalForeignBought : 0;

            let openingUSD = 0, openingTZS = 0;
            rec.openingEntries.forEach(o => {
                if (o.currency.code === "USD") openingUSD += Number(o.amount || 0);
                if (o.currency.code === "TZS") openingTZS += Number(o.amount || 0);
            });

            let closingUSD = 0, closingTZS = 0;
            rec.closingEntries.forEach(c => {
                if (c.currency.code === "USD") closingUSD += Number(c.amount || 0);
                if (c.currency.code === "TZS") closingTZS += Number(c.amount || 0);
            });

            const totalOpeningValue = openingUSD * valuationRate + openingTZS;
            const totalClosingValue = closingUSD * valuationRate + closingTZS;
            
            return sum + (totalClosingValue - totalOpeningValue);
        }, 0);

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
