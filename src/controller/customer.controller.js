const customerService = require("../service/customer.service");
const logger = require("../config/logger");

const createCustomer = async (req, res) => {
  try {
    const userId = req.user
    const customer = await customerService.createCustomer(req.body, userId);
    return res.status(201).json({ message: "Customer created successfully", data: customer });
  } catch (error) {
    logger.error("Error in createCustomer controller:", error);
    return res.status(500).json({ error: error.message });
  }
};

const getAllCustomers = async (req, res) => {
  try {
    const { page, limit, search, orderByField, orderDirection } = req.query;

    const result = await customerService.getAllCustomers(
      Number(page) || 1,
      Number(limit) || 10,
      search || "",
      orderByField || "created_at",
      orderDirection || "desc"
    );

    return res.status(200).json({ message: "Customers fetched successfully", ...result });
  } catch (error) {
    logger.error("Error in getAllCustomers controller:", error);
    return res.status(500).json({ error: error.message });
  }
};

const getCustomerById = async (req, res) => {
  try {
    const id = req.params.id;
    const customer = await customerService.getCustomerById(id);

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.status(200).json({message: "Customer fetched successfully", data: customer });
  } catch (error) {
    logger.error(`Error in getCustomerById controller for ID ${req.params.id}:`, error);
    return res.status(500).json({ error: error.message });
  }
};

const updateCustomer = async (req, res) => {
  try {
    const id = req.params.id;
    const updated = await customerService.updateCustomer(id, req.body);
    return res.status(200).json({message: "Customer updated successfully", data: updated });
  } catch (error) {
    logger.error(`Error in updateCustomer controller for ID ${req.params.id}:`, error);
    return res.status(500).json({ error: error.message });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await customerService.deleteCustomer(id);
    return res.status(200).json({message: "Customer deleted successfully"});
  } catch (error) {
    logger.error(`Error in deleteCustomer controller for ID ${req.params.id}:`, error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};
