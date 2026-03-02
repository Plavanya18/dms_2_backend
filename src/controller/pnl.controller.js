const pnlService = require('../service/pnl.service');
const logger = require('../config/logger');

/**
 * Get P&L Overview
 */
const getPnLOverview = async (req, res) => {
    try {
        const result = await pnlService.getPnLOverview();
        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        logger.error('PnL Controller error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch P&L overview'
        });
    }
};

module.exports = {
    getPnLOverview,
};
