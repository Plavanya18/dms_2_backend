const { getdb } = require("../config/db");
const logger = require("../config/logger");

const createCurrencyPair = async (data) => {
    try {
        const newPair = await getdb.currencyPairRate.create({
            data: {
                base_currency_id: Number(data.base_currency_id),
                quote_currency_id: Number(data.quote_currency_id),
                rate: data.rate,
                effective_at: new Date(),
                created_by: data.created_by,
            },
            include: {
                baseCurrency: true,
                quoteCurrency: true,
            },
        });

        logger.info(`Currency pair created: ${newPair.baseCurrency.code}/${newPair.quoteCurrency.code}`);
        return newPair;
    } catch (error) {
        logger.error("Failed to create currency pair:", error);
        throw error;
    }
};

const getAllCurrencyPairs = async (page = 1, limit = 10, search = "") => {
    try {
        const skip = (page - 1) * limit;

        const where = search
            ? {
                OR: [
                    { baseCurrency: { code: { contains: search } } },
                    { quoteCurrency: { code: { contains: search } } },
                ],
            }
            : {};

        const total = await getdb.currencyPairRate.count({ where });

        const pairs = await getdb.currencyPairRate.findMany({
            where,
            skip,
            take: limit,
            include: {
                baseCurrency: true,
                quoteCurrency: true,
            },
            orderBy: { effective_at: "desc" },
        });

        return {
            data: pairs,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    } catch (error) {
        logger.error("Failed to fetch currency pairs:", error);
        throw error;
    }
};

const updateCurrencyPair = async (id, data) => {
    try {
        const updated = await getdb.currencyPairRate.update({
            where: { id: Number(id) },
            data: {
                rate: data.rate,
                effective_at: new Date(),
            },
            include: {
                baseCurrency: true,
                quoteCurrency: true,
            },
        });

        logger.info(`Currency pair updated: ${updated.baseCurrency.code}/${updated.quoteCurrency.code}`);
        return updated;
    } catch (error) {
        logger.error(`Failed to update currency pair with ID ${id}:`, error);
        throw error;
    }
};

const deleteCurrencyPair = async (id) => {
    try {
        await getdb.currencyPairRate.delete({
            where: { id: Number(id) },
        });
        logger.info(`Currency pair deleted: ${id}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to delete currency pair with ID ${id}:`, error);
        throw error;
    }
};

module.exports = {
    createCurrencyPair,
    getAllCurrencyPairs,
    updateCurrencyPair,
    deleteCurrencyPair,
};
