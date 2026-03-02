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

        logger.info(`OpenSetRate upserted for ${record.currency.code} on ${targetDate.toISOString().split('T')[0]}`);
        return record;
    } catch (error) {
        logger.error("Failed to upsert OpenSetRate:", error);
        throw error;
    }
};

const getOpenSetRates = async (date) => {
    try {
        const dateString = new Date(date).toISOString().split('T')[0];
        const targetDate = new Date(dateString);

        const rates = await getdb.openSetRate.findMany({
            where: { date: targetDate },
            include: { currency: true },
        });

        // 1st: Previous TZS manual rate
        let previousRateRecord = await getdb.openSetRate.findFirst({
            where: {
                date: { lt: targetDate },
                currency: { code: "TZS" }
            },
            orderBy: { date: "desc" }
        });

        // 2nd: Any previous manual rate
        if (!previousRateRecord) {
            previousRateRecord = await getdb.openSetRate.findFirst({
                where: { date: { lt: targetDate } },
                orderBy: { date: "desc" }
            });
        }

        let previousRate = previousRateRecord ? Number(previousRateRecord.set_rate) : 0;

        // 3rd: Average computed from yesterday's USD deals
        if (!previousRate) {
            const yesterday = new Date(targetDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0);
            const yesterdayEnd = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);

            const yesterdayDeals = await getdb.deal.findMany({
                where: {
                    created_at: { gte: yesterdayStart, lte: yesterdayEnd },
                },
                select: {
                    amount: true,
                    amount_to_be_paid: true,
                    exchange_rate: true,
                    created_at: true,
                    buyCurrency: { select: { code: true } },
                    sellCurrency: { select: { code: true } },
                }
            });

            if (yesterdayDeals.length > 0) {
                let sumRates = 0, count = 0;
                yesterdayDeals.forEach(deal => {
                    const buyCode = deal.buyCurrency?.code;
                    const sellCode = deal.sellCurrency?.code;
                    if (buyCode !== "USD" && sellCode !== "USD") return;
                    const amount = Number(deal.amount || 0);
                    const amtPaid = Number(deal.amount_to_be_paid || 0);
                    const effective = amount > 0 ? amtPaid / amount : Number(deal.exchange_rate || 0);
                    if (effective > 0) { sumRates += effective; count++; }
                });
                if (count > 0) previousRate = Math.round(sumRates / count);
            }
        }

        return { rates, previousRate };
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
