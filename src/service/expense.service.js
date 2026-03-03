const { getdb } = require("../config/db");
const logger = require("../config/logger");

/**
 * Create a new expense
 */
const createExpense = async (data, userId) => {
    try {
        const expense = await getdb.expense.create({
            data: {
                category: data.category,
                description: data.description,
                amount: data.amount,
                rate: data.rate,
                currency_id: data.currency_id ? Number(data.currency_id) : 1,
                date: data.date ? new Date(data.date) : new Date(),
                created_by: userId,
            },
        });
        return expense;
    } catch (error) {
        logger.error("Error creating expense:", error);
        throw error;
    }
};

/**
 * Get all expenses with filters
 */
const getAllExpenses = async (params = {}) => {
    try {
        const { page = 1, limit = 10, category, currency_id, startDate, endDate, dateFilter } = params;
        const skip = (page - 1) * limit;
        const now = new Date();

        const where = {};
        if (category) where.category = category;
        if (currency_id) where.currency_id = Number(currency_id);

        if (dateFilter) {
            if (dateFilter === "today") {
                const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
                const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
                where.date = { gte: startToday, lte: endToday };
            } else if (dateFilter === "last7") {
                const d = new Date();
                d.setDate(d.getDate() - 7);
                d.setHours(0, 0, 0, 0);
                where.date = { gte: d };
            } else if (dateFilter === "last30") {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                d.setHours(0, 0, 0, 0);
                where.date = { gte: d };
            } else if (dateFilter === "last90") {
                const d = new Date();
                d.setDate(d.getDate() - 90);
                d.setHours(0, 0, 0, 0);
                where.date = { gte: d };
            } else if (dateFilter === "custom" && (startDate || endDate)) {
                where.date = {};
                if (startDate) where.date.gte = new Date(startDate);
                if (endDate) where.date.lte = new Date(endDate);
            }
        } else if (startDate || endDate) {
            where.date = {};
            if (startDate) where.date.gte = new Date(startDate);
            if (endDate) where.date.lte = new Date(endDate);
        }

        const expenses = await getdb.expense.findMany({
            where,
            skip,
            take: Number(limit),
            orderBy: { date: "desc" },
            include: {
                createdBy: { select: { id: true, full_name: true } },
                currency: { select: { id: true, code: true, symbol: true } }
            },
        });

        const total = await getdb.expense.count({ where });

        return {
            data: expenses,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / limit),
            },
        };
    } catch (error) {
        logger.error("Error fetching expenses:", error);
        throw error;
    }
};

/**
 * Update an expense
 */
const updateExpense = async (id, data, userId) => {
    try {
        const updateData = {
            category: data.category,
            description: data.description,
            amount: data.amount,
            rate: data.rate,
            currency_id: data.currency_id ? Number(data.currency_id) : undefined,
            date: data.date ? new Date(data.date) : undefined,
        };

        // Remove undefined fields
        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

        return await getdb.expense.update({
            where: { id: Number(id) },
            data: updateData,
        });
    } catch (error) {
        logger.error("Error updating expense:", error);
        throw error;
    }
};

/**
 * Delete an expense
 */
const deleteExpense = async (id, userId) => {
    try {
        // Basic check could be added here to see if the user has permission
        return await getdb.expense.delete({
            where: { id: Number(id) },
        });
    } catch (error) {
        logger.error("Error deleting expense:", error);
        throw error;
    }
};

module.exports = {
    createExpense,
    getAllExpenses,
    updateExpense,
    deleteExpense,
};
