const expenseService = require('../service/expense.service');
const logger = require('../config/logger');

const createExpense = async (req, res) => {
    try {
        const expense = await expenseService.createExpense(req.body, req.user);
        res.status(201).json({ success: true, data: expense });
    } catch (error) {
        logger.error('Create expense error:', error);
        res.status(500).json({ success: false, message: 'Failed to create expense' });
    }
};

const getAllExpenses = async (req, res) => {
    try {
        const result = await expenseService.getAllExpenses(req.query);
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error('Get expenses error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch expenses' });
    }
};

const updateExpense = async (req, res) => {
    try {
        const expense = await expenseService.updateExpense(req.params.id, req.body, req.user);
        res.json({ success: true, data: expense });
    } catch (error) {
        logger.error('Update expense error:', error);
        res.status(500).json({ success: false, message: 'Failed to update expense' });
    }
};

const deleteExpense = async (req, res) => {
    try {
        await expenseService.deleteExpense(req.params.id, req.user);
        res.json({ success: true, message: 'Expense deleted successfully' });
    } catch (error) {
        logger.error('Delete expense error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete expense' });
    }
};

module.exports = {
    createExpense,
    getAllExpenses,
    updateExpense,
    deleteExpense,
};
