const { getdb } = require("../config/db");
const logger = require("../config/logger");

const createDeal = async (data, userId) => {
    try {
        const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
        const randomSuffix = Math.floor(Math.random() * 1000);
        const deal_number = `DL-${timestamp}-${randomSuffix}`;


        const newDeal = await getdb.deal.create({
            data: {
                deal_number: deal_number,
                customer_name: data.customer_name,
                deal_type: data.deal_type,
                transaction_mode: data.transaction_mode,
                amount: data.amount,
                rate: data.rate,
                received_price: data.received_price,
                received_quantity: data.received_quantity,
                received_currency_id: data.received_currency_id,
                paid_price: data.paid_price,
                paid_quantity: data.paid_quantity,
                paid_currency_id: data.paid_currency_id,
                remarks: data.remarks || null,
                status_id: data.status_id,
                created_by: userId,
                created_at: new Date(),
                updated_at: new Date(),
            },
        });

        logger.info(`Deal created: ${newDeal.deal_number}`);
        return newDeal;

    } catch (error) {
        logger.error("Failed to create deal:", error);
        throw error;
    }
};

const getAllDeals = async (
    page = 1,
    limit = 10,
    search = "",
    statusName = "",
    currencyName = "",
    orderByField = "created_at",
    orderDirection = "desc"
) => {
    try {
        const skip = (page - 1) * limit;

        const where = search
            ? {
                OR: [
                    { deal_number: { contains: search } },
                    { customer_name: { contains: search } },
                ],
            }
            : {};
            
        if (statusName) {
            where.status = { name: { contains: statusName} };
        }

        if (currencyName) {
            where.OR = where.OR
                ? [
                    ...where.OR,
                    { receivedCurrency: { code: { contains: currencyName} } },
                    { paidCurrency: { code: { contains: currencyName} } }
                  ]
                : [
                    { receivedCurrency: { code: { contains: currencyName} } },
                    { paidCurrency: { code: { contains: currencyName} } }
                  ];
        }

        const total = await getdb.deal.count({ where });

        const deals = await getdb.deal.findMany({
            where,
            skip,
            take: limit,
            orderBy: { 
                [orderByField]: orderDirection 
            },
            include: {
                status: true,
                receivedCurrency: true,
                paidCurrency: true,
                createdBy: {
                    select: {
                        id: true,
                        full_name: true,
                        email: true
                    }
                },
            },
        });

        return {
            data: deals,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };

    } catch (error) {
        logger.error("Failed to fetch deals:", error);
        throw error;
    }
};

const getDealById = async (id) => {
    try {
        return await getdb.deal.findUnique({
            where: { id: Number(id) },
            include: {
                status: true,
                receivedCurrency: true,
                paidCurrency: true,
                createdBy: { 
                    select: { 
                        id: true,
                        full_name: true,
                        email: true 
                    } 
                },
                actionBy: { 
                    select: { 
                        id: true,
                        full_name: true,
                        email: true 
                    } 
                },
                downloadedBy: { 
                    select: { 
                        id: true,
                        full_name: true,
                        email: true 
                    } 
                },
            },
        });

    } catch (error) {
        logger.error(`Failed to fetch deal with ID ${id}:`, error);
        throw error;
    }
};

const updateDealStatus = async (id, status_id, reason = null, userId) => {
    try {
        const updated = await getdb.deal.update({
            where: { id: Number(id) },
            data: {
                status_id,
                action_by: userId,
                action_reason: reason,
                action_at: new Date(),
                updated_at: new Date(),
            },
        });

        logger.info(`Deal status updated: ${updated.id} ${updated.deal_number}`);
        return updated;

    } catch (error) {
        logger.error(`Failed to update deal status for ID ${id}:`, error);
        throw error;
    }
};

module.exports = {
    createDeal,
    getAllDeals,
    getDealById,
    updateDealStatus,
};

