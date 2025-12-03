const statusService = require("../service/status.service");
const logger = require("../config/logger");

const createDealStatus = async (req, res) => {
  try {
    const result = await statusService.createDealStatus(req.body);
    res.status(201).json({ message: "Deal Status created successfully", data: result });
  } catch (error) {
    logger.error("Error creating DealStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const updateDealStatus = async (req, res) => {
  try {
    const result = await statusService.updateDealStatus(req.params.id, req.body);
    res.status(200).json({ message: "Deal Status updated successfully", data: result });
  } catch (error) {
    logger.error("Error updating DealStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const getDealStatusById = async (req, res) => {
  try {
    const result = await statusService.getDealStatusById(req.params.id);
    res.status(200).json({ data: result });
  } catch (error) {
    logger.error("Error fetching DealStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const getDealStatusList = async (req, res) => {
  try {
    const result = await statusService.getDealStatusList();
    res.status(200).json({ 
        message: "Deal Status fetched successfully", 
        data: result 
    });
  } catch (error) {
    logger.error("Error listing DealStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const deleteDealStatus = async (req, res) => {
  try {
    const result = await statusService.deleteDealStatus(req.params.id);
    res.status(200).json({ message: "Deal Status deleted successfully" });
  } catch (error) {
    logger.error("Error deleting DealStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const createreconciliationStatus = async (req, res) => {
  try {
    const result = await statusService.createreconciliationStatus(req.body);
    res.status(201).json({ message: "reconciliation Status created successfully", data: result });
  } catch (error) {
    logger.error("Error creating reconciliationStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const updatereconciliationStatus = async (req, res) => {
  try {
    const result = await statusService.updatereconciliationStatus(req.params.id, req.body);
    res.status(200).json({ message: "Reconciliation Status updated successfully", data: result });
  } catch (error) {
    logger.error("Error updating reconciliationStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const getreconciliationStatusById = async (req, res) => {
  try {
    const result = await statusService.getDealStatusById(req.params.id);
    res.status(200).json({ 
        message: "Reconciliation Status fetched successfully",
        data: result });
  } catch (error) {
    logger.error("Error fetching reconciliationStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const getreconciliationStatusList = async (req, res) => {
  try {
    const result = await statusService.getreconciliationStatusList();
    res.status(200).json({ 
        message: "Reconciliation Status fetched successfully", 
        data: result });
  } catch (error) {
    logger.error("Error listing reconciliationStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

const deletereconciliationStatus = async (req, res) => {
  try {
    const result = await statusService.deletereconciliationStatus(req.params.id);
    res.status(200).json({ message: "Reconciliation Status deleted successfully", data: result });
  } catch (error) {
    logger.error("Error deleting reconciliationStatus:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createDealStatus,
  updateDealStatus,
  getDealStatusById,
  getDealStatusList,
  deleteDealStatus,
  createreconciliationStatus,
  updatereconciliationStatus,
  getreconciliationStatusById,
  getreconciliationStatusList,
  deletereconciliationStatus,
};
