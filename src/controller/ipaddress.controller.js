const idaddressController = require("../service/ipaddress.service");
const logger = require("../config/logger");

const createIpController = async (req, res) => {
  try {
    const ip = await idaddressController.createIp(req.body);

    res.status(201).json({
      message: "IP address created successfully",
      data: ip,
    });
  } catch (err) {
    logger.error("Error creating IP address:", err);
    res.status(500).json({
      message: "Error creating IP address",
      error: err.message,
    });
  }
};

const getAllIpsController = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = "" ,
      orderBy = "created_at", 
      direction = "desc" } = req.query;
    
    const ips = await  idaddressController.getAllIps(
      parseInt(page, 10),
      parseInt(limit, 10),
      search,
      orderBy,
      direction
    );
    res.status(200).json({
      message: "IP addresses fetched successfully",
      data: ips.data,
      pagination: ips.pagination,
      sort: ips.sort
    });
  } catch (err) {
    logger.error("Error fetching IP addresses:", err);
    res.status(500).json({
      message: "Error fetching IP addresses",
      error: err.message,
    });
  }
};

const getIpByIdController = async (req, res) => {
  try {
    const { id } = req.params;
    const ip = await idaddressController.getIpById(id);

    if (!ip) {
      logger.warn(`IP address not found with ID: ${id}`);
      return res.status(404).json({
        message: "IP address not found",
      });
    }

    res.status(200).json({
      message: "IP address fetched successfully",
      data: ip,
    });
  } catch (err) {
    logger.error(`Error fetching IP address with ID ${req.params.id}:`, err);
    res.status(500).json({
      message: "Error fetching IP address",
      error: err.message,
    });
  }
};

const updateIpController = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await idaddressController.updateIp(id, req.body);

    if (!updated) {
      logger.warn(`IP address not found to update with ID: ${id}`);
      return res.status(404).json({
        message: "IP address not found",
      });
    }

    res.status(200).json({
      message: "IP address updated successfully",
      data: updated,
    });
  } catch (err) {
    logger.error(`Error updating IP address with ID ${req.params.id}:`, err);
    res.status(500).json({
      message: "Error updating IP address",
      error: err.message,
    });
  }
};

const deleteIpController = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await idaddressController.deleteIp(id);

    if (!deleted) {
      logger.warn(`IP address not found to delete with ID: ${id}`);
      return res.status(404).json({
        message: "IP address not found",
      });
    }

    res.status(200).json({
      message: "IP address deleted successfully",
    });
  } catch (err) {
    logger.error(`Error deleting IP address with ID ${req.params.id}:`, err);
    res.status(500).json({
      message: "Error deleting IP address",
      error: err.message,
    });
  }
};

module.exports = {
  createIpController,
  getAllIpsController,
  getIpByIdController,
  updateIpController,
  deleteIpController,
};
