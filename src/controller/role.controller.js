const roleService = require("../service/role.service");
const logger = require("../config/logger");

const createRole = async (req, res) => {
  try {
    const data = req.body;
    const role = await roleService.createRole(data);
    res.status(201).json({
      message: "Role created successfully",
      data: role});
  } catch (error) {
    logger.error("Error creating role:", error);
    res.status(500).json({ error: "Failed to create role" });
  }
};

const getAllRoles = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = "", 
      orderBy = "created_at", 
      direction = "desc" 
    } = req.query;

    const rolesResult = await roleService.getAllRoles(
      Number(page), 
      Number(limit), 
      search, 
      orderBy, 
      direction
    );

    res.json({
      message: "Roles fetched successfully",
      data: rolesResult.data,
      pagination: rolesResult.pagination,
      sort: rolesResult.sort,
    });
  } catch (error) {
    logger.error("Error fetching roles:", error);
    res.status(500).json({ error: "Failed to fetch roles" });
  }
};

const getRoleById = async (req, res) => {
  try {
    const id = req.params.id;
    const role = await roleService.getRoleById(id);
    if (!role) return res.status(404).json({ error: "Role not found" });
    res.json({
      message: "Role fetched successfully",
      data: role
    });
  } catch (error) {
    logger.error("Error fetching role:", error);
    res.status(500).json({ error: "Failed to fetch role" });
  }
};

const updateRole = async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;
    const updated = await roleService.updateRole(id, data);
    res.json({
      message: "Role updated successfully",
      data: updated
    });
  } catch (error) {
    logger.error("Error updating role:", error);
    res.status(500).json({ error: "Failed to update role" });
  }
};

const deleteRole = async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await roleService.deleteRole(id);
    res.json({
      message: "Role deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting role:", error);
    res.status(500).json({ error: "Failed to delete role" });
  }
};

module.exports = {
  createRole,
  getAllRoles,
  getRoleById,
  updateRole,
  deleteRole,
};
