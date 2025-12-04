const userService = require("../service/user.service");
const logger = require("../config/logger");

const createUserController = async (req, res) => {
  try {
    const user = await userService.createUser(req.body);

    res.status(201).json({
      message: "User created successfully",
      data: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role
      },
    });

  } catch (err) {
    logger.warn(`User creation failed: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
};

const updateUserController = async (req, res) => {
  try {
    const user = await userService.updateUser(req.params.id, req.body);
    res.status(200).json({
      message: "Changes Saved Successfully",
      data: user
    });
  } catch (err) {
    logger.error("Error updating user:", err);
    res.status(500).json({ error: err.message });
  }
};

const listUsersController = async (req, res) => {
  try {
    const { 
      page = 1,
      limit = 10, 
      search = "",
      orderBy = "created_at", 
      direction = "desc" 
     } = req.query;

    const users = await userService.listUsers(
      parseInt(page), 
      parseInt(limit),
      search,
      orderBy,
      direction);
    res.status(200).json({
      message: "Users fetched successfully",
      data: users.data,
      pagination: users.pagination,
      sort: users.sort
    });
  } catch (err) {
    logger.error("Error fetching users:", err);
    res.status(500).json({ error: err.message });
  }
};

const getuserIdController = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await userService.getUserById(id);
    if (!user) return res.status(404).json({ error: "user not found" });
    res.status(200).json({
      message: "User fetched successfully",
      user
    }
    );
  } catch (err) {
    logger.error("Error fetching user:", err);
    res.status(500).json({ error: err.message });
  }
};

const toggleUserActiveController = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, reason } = req.body;
    
    const performedById = req.user;

    const user = await userService.toggleUserActive(id, is_active, performedById, reason);

    res.status(200).json({
      message: `User ${is_active ? "activated" : "deactivated"} successfully`,
      user,
    });
  } catch (err) {
    logger.error("Failed to change user status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getLoggedInUserController = async (req, res) => {
  try {
    console.log("req.user.user_id", req.user);
    const user = await userService.getLoggedInUser(req.user);
    res.status(200).json(user);
  } catch (err) {
    logger.error("Failed to fetch logged-in user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

const logoutController = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Authorization header missing" });
    }

    const token = authHeader.replace("Bearer", "").trim();
    if (!token) {
      return res.status(401).json({ message: "Invalid token format" });
    }

    const response = await userService.logoutUser(token);

    return res.status(200).json({
      message: "User logged out successfully",
    });

  } catch (error) {
    const statusCode =
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500; 
    return res.status(statusCode).json({
      message: error.message || "Logout failed",
    });
  }
};

const deleteUser = async (req, res) => {
  try {
    const id = req.params.id;
    const user_id=req.user
    const deleted = await userService.deleteUser(id, user_id);
    res.json({
      message: "Account Deleted",
    });
  } catch (error) {
    logger.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};

module.exports = {
  createUserController,
  updateUserController,
  listUsersController,
  getuserIdController,
  toggleUserActiveController,
  getLoggedInUserController,
  logoutController,
  deleteUser,
};
