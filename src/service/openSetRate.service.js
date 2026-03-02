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
            },
            create: {
                currency_id: Number(currency_id),
                set_rate: set_rate,
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

        // 1st: Try previous TZS set rate
        let previousRateRecord = await getdb.openSetRate.findFirst({
            where: {
                date: { lt: targetDate },
                currency: { code: "TZS" }
            },
            orderBy: { date: "desc" }
        });

        // 2nd: Any previous set rate regardless of currency
        if (!previousRateRecord) {
            previousRateRecord = await getdb.openSetRate.findFirst({
                where: { date: { lt: targetDate } },
                orderBy: { date: "desc" }
            });
        }

        let previousRate = previousRateRecord ? Number(previousRateRecord.set_rate) : 0;

        if (!previousRate) {
            const yesterday = new Date(targetDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStart = new Date(yesterday);
            yesterdayStart.setHours(0, 0, 0, 0);
            const yesterdayEnd = new Date(yesterday);
            yesterdayEnd.setHours(23, 59, 59, 999);

            const yesterdayDeals = await getdb.deal.findMany({
                where: {
                    created_at: { gte: yesterdayStart, lte: yesterdayEnd },
                    OR: [
                        { buyCurrency: { code: "TZS" } },
                        { sellCurrency: { code: "TZS" } }
                    ]
                },
                select: {
                    amount: true,
                    amount_to_be_paid: true,
                    exchange_rate: true,
                    created_at: true
                }
            });

            if (yesterdayDeals.length > 0) {
                let sumRates = 0, count = 0;
                yesterdayDeals.forEach(deal => {
                    const amount = Number(deal.amount || 0);
                    const amountPaid = Number(deal.amount_to_be_paid || 0);
                    const effectiveRate = amount > 0 ? amountPaid / amount : Number(deal.exchange_rate || 0);
                    if (effectiveRate > 0) {
                        sumRates += effectiveRate;
                        count++;
                    }
                });
                if (count > 0) previousRate = Math.round(sumRates / count);
            }
        }

        return {
            rates,
            previousRate
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
