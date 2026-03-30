const { getdb } = require("../config/db");
const logger = require("../config/logger");

// ✅ Standardized date formatter to prevent timezone shifts (YYYY-MM-DD)
const formatDate = (date) => {
    if (!date) return "";
    const d = new Date(date);
    // Using getUTC* to ensure consistency across servers, as pre_date/created_at are stored as UTC
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const upsertOpenSetRate = async (data) => {
    try {
        const { currency_id, set_rate, date } = data;
        const dateString = formatDate(date);
        const targetDate = new Date(dateString + "T00:00:00Z");

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

        logger.info(`OpenSetRate upserted for ${record.currency.code} on ${formatDate(targetDate)}`);
        return record;
    } catch (error) {
        logger.error("Failed to upsert OpenSetRate:", error);
        throw error;
    }
};

const getOpenSetRates = async (date) => {
    try {
        const dateString = formatDate(date);
        const targetDate = new Date(dateString + "T00:00:00Z");

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

        // 3rd: Average computed from the MOST RECENT day with deals (if previousRate still 0)
        if (!previousRate) {
            // Find the most recent deal date before targetDate
            const lastDeal = await getdb.deal.findFirst({
                where: {
                    OR: [
                        { pre_date: { lt: targetDate } },
                        { pre_date: null, created_at: { lt: targetDate } }
                    ],
                    deleted_at: null,
                    AND: [
                        { OR: [{ buyCurrency: { code: "USD" } }, { sellCurrency: { code: "USD" } }] }
                    ]
                },
                orderBy: { pre_date: "desc" }, // fallbacks handled by DB ordering usually
                select: { pre_date: true, created_at: true }
            });

            if (lastDeal) {
                const effectiveLastDate = lastDeal.pre_date || lastDeal.created_at;
                const lastDateStart = new Date(effectiveLastDate);
                lastDateStart.setHours(0, 0, 0, 0);
                const lastDateEnd = new Date(effectiveLastDate);
                lastDateEnd.setHours(23, 59, 59, 999);

                const recentDeals = await getdb.deal.findMany({
                    where: {
                        OR: [
                            { pre_date: { gte: lastDateStart, lte: lastDateEnd } },
                            { pre_date: null, created_at: { gte: lastDateStart, lte: lastDateEnd } }
                        ],
                        deleted_at: null,
                        AND: [
                            { OR: [{ buyCurrency: { code: "USD" } }, { sellCurrency: { code: "USD" } }] }
                        ]
                    },
                    select: {
                        amount: true,
                        amount_to_be_paid: true,
                        exchange_rate: true,
                        deal_type: true,
                        buyCurrency: { select: { code: true } },
                        sellCurrency: { select: { code: true } },
                    }
                });

                if (recentDeals.length > 0) {
                    let sumRates = 0, count = 0;
                    recentDeals.forEach(deal => {
                        if (deal.deal_type === "buy") {
                            const amount = Number(deal.amount || 0);
                            const amtPaid = Number(deal.amount_to_be_paid || 0);
                            const effective = amount > 0 ? amtPaid / amount : Number(deal.exchange_rate || 0);
                            if (effective > 0) { sumRates += effective; count++; }
                        }
                    });
                    if (count > 0) previousRate = Math.round(sumRates / count);
                }
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
        const dateString = formatDate(date);
        const targetDate = new Date(dateString + "T00:00:00Z");

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

const propagateAverageRateToNextDay = async (todayDateInput, userId) => {
    try {
        const today = new Date(todayDateInput);
        const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
        const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999));

        const deals = await getdb.deal.findMany({
            where: {
                OR: [
                    { pre_date: { gte: start, lte: end } },
                    { pre_date: null, created_at: { gte: start, lte: end } }
                ],
                deleted_at: null,
                AND: [
                    {
                        OR: [
                            { buyCurrency: { code: "USD" } },
                            { sellCurrency: { code: "USD" } }
                        ]
                    }
                ]
            },
            select: {
                amount: true,
                amount_to_be_paid: true,
                exchange_rate: true,
                deal_type: true,
                buyCurrency: { select: { code: true } },
                sellCurrency: { select: { code: true } }
            }
        });

        let averageRate = 0;
        if (deals.length > 0) {
            let sumRates = 0, count = 0;
            deals.forEach(deal => {
                if (deal.deal_type === "buy") {
                    const rate = Number(deal.exchange_rate || 0);
                    if (rate > 0) {
                        sumRates += rate;
                        count++;
                    }
                }
            });
            if (count > 0) averageRate = Math.round(sumRates / count);
        }

        // 2. If no deals today, fallback to today's manual opensetrate
        if (averageRate === 0) {
            const todayRate = await getdb.openSetRate.findFirst({
                where: { date: start, currency: { code: "TZS" } }
            });
            if (todayRate) averageRate = Number(todayRate.set_rate);
        }

        // 3. Fallback to any previous rate if still 0
        if (averageRate === 0) {
            const lastRate = await getdb.openSetRate.findFirst({
                where: { currency: { code: "TZS" } },
                orderBy: { date: "desc" }
            });
            if (lastRate) averageRate = Number(lastRate.set_rate);
        }

        if (averageRate === 0) return null; // No baseline available

        // 4. Upsert for Tomorrow
        const tomorrow = new Date(start);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

        const tzsCurrency = await getdb.currency.findUnique({ where: { code: "TZS" } });
        if (!tzsCurrency) {
            logger.warn("TZS currency not found for rate propagation");
            return null;
        }

        const record = await getdb.openSetRate.upsert({
            where: {
                currency_id_date: {
                    currency_id: tzsCurrency.id,
                    date: tomorrow,
                },
            },
            update: { set_rate: averageRate },
            create: {
                currency_id: tzsCurrency.id,
                set_rate: averageRate,
                date: tomorrow,
            },
        });

        logger.info(`Propagated average rate ${averageRate} from ${formatDate(start)} to ${formatDate(tomorrow)}`);
        return record;
    } catch (error) {
        logger.error("Failed to propagate average rate:", error);
        throw error;
    }
};

module.exports = {
    upsertOpenSetRate,
    getOpenSetRates,
    getRateByDateAndCurrency,
    propagateAverageRateToNextDay,
};
