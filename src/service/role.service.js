const { getdb } = require("../config/db");
const logger = require("../config/logger");

const createRole = async (data) => {
  try {
    const timestamp = new Date();

    const newRole = await getdb.role.create({
      data: {
        name: data.name,
        description: data.description || null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    });

    logger.info(`Role created: ${newRole.name}`);
    return newRole;
  } catch (error) {
    logger.error("Failed to create role:", error);
    throw error;
  }
};

const getAllRoles = async (page = 1, limit = 10, search = "", orderByField = "created_at", orderDirection = "desc") => {
  try {
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } },
          ],
        }
      : {};

    const total = await getdb.role.count({ where });

    const roles = await getdb.role.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [orderByField]: orderDirection },
    });

    return {
      data: roles,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      sort: {
        field: orderByField,
        direction: orderDirection,
      },
    };
  } catch (error) {
    logger.error("Failed to fetch roles:", error);
    throw error;
  }
};

const getRoleById = async (id) => {
  try {
    const role = await getdb.role.findUnique({
      where: { id: Number(id) },
    });
    return role;
  } catch (error) {
    logger.error(`Failed to fetch role with ID ${id}:`, error);
    throw error;
  }
};

const updateRole = async (id, data) => {
  try {
    const updated = await getdb.role.update({
      where: { id: Number(id) },
      data: { ...data, updated_at: new Date() },
    });
    logger.info(`Role updated: ${updated.name}`);
    return updated;
  } catch (error) {
    logger.error(`Failed to update role with ID ${id}:`, error);
    throw error;
  }
};

const deleteRole = async (id) => {
  try {
    const deleted = await getdb.role.delete({
      where: { id: Number(id) },
    });
    logger.info(`Role deleted: ${deleted.name}`);
    return deleted;
  } catch (error) {
    logger.error(`Failed to delete role with ID ${id}:`, error);
    throw error;
  }
};

module.exports = {
  createRole,
  getAllRoles,
  getRoleById,
  updateRole,
  deleteRole,
};
