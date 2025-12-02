const { getdb } = require("../config/db");
const bcrypt = require("bcryptjs");
const logger = require("../config/logger");
const { sendEmail } = require("../utils/mailer");
const ApiError = require("../utils/ApiError");
const httpStatus = require("http-status");
const crypto = require("crypto");
const { date } = require("joi");


const generatePassword = () => {
  return crypto.randomBytes(3).toString("base64").slice(0, Math.floor(Math.random() * 3) + 4);
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const createUser = async (data) => {
  try {
    
    const timestamp = new Date();
    
    if (!data.email) {
      throw new Error("Email is required.");
    }

    if (!isValidEmail(data.email)) {
      throw new Error("Invalid email format.");
    }

    const existingUser = await getdb.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      throw new Error("Email already registered.");
    }

    const plainPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const user = await getdb.user.create({
      data: {
        full_name: data.full_name,
        email: data.email,
        password: hashedPassword,
        role_id: data.role_id,
        phone_number: data.phone_number,
        is_active: true,
        must_change_password: true,
        created_at: timestamp,
        updated_at: timestamp,
      },
      include:{
        role:{
          select:{
            id: true,
            name: true
          }
        }
      }
    });

    const now = new Date();
    const passwordExpiry = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days
    console.log("Expiry (local):", passwordExpiry.toLocaleString());

    await getdb.userDetail.create({
      data: {
        user_id: user.id,
        password_expiry_date:passwordExpiry,
        failed_login_attempts: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    });

    try {
      const subject = "Your Forex Portal Login Credentials for DMS_2";
      await sendEmail(
        data.email,
        subject,
        `Hello ${data.full_name},`,
        `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #333;">
          <p>Your account has been created successfully.</p>
          <p>Login Email: <b>${data.email}</b></p>
          <p><b>Temporary Password:</b> ${plainPassword}</p>
          <p>Please log in and change your password immediately.</p>
          <hr />
          <p>Regards,<br/>DMS_2 Admin Team</p>
        </div>`
      );
    } catch (emailError) {
      await getdb.userDetail.delete({ where: { user_id: user.id } });
      await getdb.user.delete({ where: { id: user.id } });
      throw new Error("Email could not be delivered. User not created.");
    }

    return user;

  } catch (err) {
    throw err;
  }
};

const listUsers = async (page = 1, limit = 10, search = "", orderByField = "created_at", orderDirection = "desc") => {
  try {
    const skip = (page - 1) * limit;

      const where = {
      deleted_at: null,
      ...(search
        ? {
            OR: [
              { full_name: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
    };


    const totalUsers = await getdb.user.count({ where });

    const users = await getdb.user.findMany({
      where,
      include:{
        role:{
          select:{
            id: true,
            name: true,
          }
        },
      },
      skip,
      take: limit,
      orderBy: { [orderByField]: orderDirection },
    });

    return {
      data: users,
      pagination: {
        total: totalUsers,
        page,
        limit,
        totalPages: Math.ceil(totalUsers / limit),
      },
      sort: {
        field: orderByField,
        direction: orderDirection,
      },
    };
  } catch (error) {
    logger.error("Failed to fetch users:", error);
    throw error;
  }
};

const getUserById = async (id) => {
  try {
    const user = await getdb.user.findUnique({
      where: { id: parseInt(id) },
      include: {
        role:{
          select:{
            id: true,
            name: true
        }
        },
        details: true,
        sessions: {
          orderBy: { login_time: "desc" },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }

    return user;
  } catch (error) {
    logger.error(`Failed to fetch user with ID ${id}:`, error);
    throw error;
  }
};

const updateUser = async (id, data) => {
  try {
    const updateData = { ...data };

    if (data.password) {
      const hashedPassword = await bcrypt.hash(data.password, 10);
      updateData.password = hashedPassword;
      delete updateData.password; 
    }

    const user = await getdb.user.update({
      where: { id: Number(id) },
      data: updateData,
    });

    logger.info(`User updated successfully: ${user.email}`);
    return user;
  } catch (error) {
    logger.error(`Failed to update user with ID ${id}:`, error);
    throw error;
  }
};

const toggleUserActive = async (id, is_active, performedById = null, reason = null) => {
  try {
    const timestamp = new Date();

    const updateData = {
      is_active,
      updated_at: timestamp,
    };

    if (!is_active) {
      updateData.deactivated_at = timestamp;
      updateData.deactivated_by = performedById;
      updateData.deactivation_reason = reason || "Deactivated by admin";
    } else {
      updateData.deactivated_at = null;
      updateData.deactivated_by = null;
      updateData.deactivation_reason = null;
      updateData.force_logout = false;
    }

    const user = await getdb.user.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: { details: true },
    });

    logger.info(`User ${is_active ? "activated" : "deactivated"}: ${user.email}`);

    return user;
  } catch (error) {
    logger.error(`Failed to toggle user status for ID ${id}:`, error);
    throw error;
  }
};

const getLoggedInUser = async (user_id) => {
  try {
    const user = await getdb.user.findUnique({ 
      where: { id: parseInt(user_id) } 
    });
    return user;
  } catch (error) {
    logger.error("Failed to fetch logged-in user:", error);
    throw error;
  }
};

const getUserSessions = async (user_id) => {
  try {
    const sessions = await getdb.userSession.findMany({
      where: { user_id },
      include: { ip: true },
    });
    return sessions;
  } catch (error) {
    logger.error("Failed to fetch user sessions:", error);
    throw error;
  }
};

const logoutUser = async (token) => {
 const session = await getdb.userSession.findFirst({
    where: { token },
  });

  if (!session) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Session not found");
  }

  if (session.logout_time) {
    logger.warn(`User session already logged out: user_id=${session.user_id}`);
    throw new ApiError(httpStatus.BAD_REQUEST, "User already logged out");
  }

  await getdb.userSession.update({
    where: { id: session.id },
    data: { logout_time: new Date() ,
      updated_at: new Date(),
      session_status: "inactive",
    },
  });

  const deletedDeals = await getdb.deal.updateMany({
    where: {
      created_by: session.user_id,
      deleted_at: null,
    },
    data: {
      deleted_at: new Date(),
    },
  });

  logger.info(
    `User logged out successfully: user_id=${session.user_id}, deals_deleted=${deletedDeals.count}`
  );

  return {
    message: "Logout successful",
    deals_deleted: deletedDeals.count,
  };
};

const deleteUser = async (id, user_id) => {
  const userId = Number(id);

  try {
    const user = await getdb.user.findUnique({ where: { id: userId } });
    if (!user) {
      logger.warn(`User not found with ID ${userId}`);
      throw new Error("User not found");
    }

    const deletedUser = await getdb.user.update({
      where: { id: userId },
      data: {
        deleted_by: parseInt(user_id),
        deleted_at: new Date(),
      }
    });

    logger.info(`User deleted successfully: ${deletedUser.full_name}`);
    return deletedUser;

  } catch (error) {
    logger.error(`Error deleting user with ID ${id}:`, error);
    throw new Error("Failed to delete user or related records");
  }
};

module.exports = {
  createUser,
  updateUser,
  listUsers,
  getUserById,
  toggleUserActive,
  getLoggedInUser,
  getUserSessions,
  logoutUser,
  deleteUser,
};