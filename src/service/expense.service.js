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
        const { page = 1, limit = 10, category, currency_id, startDate, endDate } = params;
        const skip = (page - 1) * limit;

        const where = {};
        if (category) where.category = category;
        if (currency_id) where.currency_id = Number(currency_id);
        if (startDate || endDate) {
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
