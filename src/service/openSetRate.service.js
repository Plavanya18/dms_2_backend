const { getdb } = require("../config/db");
const logger = require("../config/logger");

const upsertOpenSetRate = async (data) => {
    try {
        const { currency_id, set_rate, date } = data;
        const dateString = new Date(date).toISOString().split('T')[0];
        const targetDate = new Date(dateString);

        const record = await getdb.openSetRate.upsert({
            where: {
                currency_id_date: {
                    currency_id: Number(currency_id),
                    date: targetDate,
                },
            },
            update: {
                set_rate: set_rate,
                open_rate: 0, // Temporary fallback until migration is complete
            },
            create: {
                currency_id: Number(currency_id),
                set_rate: set_rate,
                open_rate: 0, // Temporary fallback until migration is complete
                date: targetDate,
            },
            include: {
                currency: true,
            },
        });

        logger.info(`OpenSetRate record upserted for currency ${record.currency.code} on date ${targetDate.toISOString().split('T')[0]}`);
        return record;
    } catch (error) {
        logger.error("Failed to upsert OpenSetRate:", error);
        throw error;
    }
};

const getOpenSetRates = async (date) => {
    try {
        // Use only the date part to avoid timezone shifts
        const dateString = new Date(date).toISOString().split('T')[0];
        const targetDate = new Date(dateString);

        const rates = await getdb.openSetRate.findMany({
            where: {
                date: targetDate,
            },
            include: {
                currency: true,
            },
        });

        let previousRateRecord = await getdb.openSetRate.findFirst({
            where: {
                date: { lt: targetDate },
                currency: { code: "USD" }
            },
            orderBy: { date: "desc" }
        });

        if (!previousRateRecord) {
            previousRateRecord = await getdb.openSetRate.findFirst({
                where: { date: { lt: targetDate } },
                orderBy: { date: "desc" }
            });
        }

        return {
            rates,
            previousRate: previousRateRecord ? Number(previousRateRecord.set_rate) : 0
        };
    } catch (error) {
        logger.error("Failed to fetch OpenSetRates:", error);
        throw error;
    }
};

const getRateByDateAndCurrency = async (currency_id, date) => {
    try {
        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

        return await getdb.openSetRate.findUnique({
            where: {
                currency_id_date: {
                    currency_id: Number(currency_id),
                    date: targetDate,
                },
            },
        });
    } catch (error) {
        logger.error("Failed to fetch OpenSetRate by date and currency:", error);
        throw error;
    }
};

module.exports = {
    upsertOpenSetRate,
    getOpenSetRates,
    getRateByDateAndCurrency,
};
