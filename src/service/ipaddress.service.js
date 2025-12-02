const { getdb } = require("../config/db");
const logger = require("../config/logger");

const createIp = async (data) => {
  try {
    const ip = await getdb.ipAddress.create({ data:{
      ip_address: data.ip_address,
      location: data.location,
      country: data.country,
      isp: data.isp,
      device_info: data.device_info,
      created_at: new Date(),
    } });
    logger.info(`IP address created: ${ip.ip_address}`);
    return ip;
  } catch (error) {
    logger.error("Failed to create IP address:", error);
    throw error;
  }
};

const getAllIps = async (
  page = 1,
  limit = 10,
  search = "",
  orderByField = "created_at",
  orderDirection = "desc"
) => {
  try {
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { ip_address: { contains: search} },
            { location: { contains: search} },
            { country: { contains: search} },
            { isp: { contains: search} },
            { device_info: { contains: search} },
          ],
        }
      : {};

    const ips = await getdb.ipAddress.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [orderByField]: orderDirection },
    });

    const total = await getdb.ipAddress.count({ where });

    return {
      data: ips,
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
    logger.error("❌ Failed to fetch IP addresses:", error);
    throw new Error("Failed to fetch IP addresses");
  }
};

const getIpById = async (id) => {
  try {
    const ip = await getdb.ipAddress.findUnique({
      where: { id: Number(id) },
    });
    return ip;
  } catch (error) {
    logger.error(`Failed to fetch IP with ID ${id}:`, error);
    throw error;
  }
};

const updateIp = async (id, data) => {
  try {
    const updated = await getdb.ipAddress.update({
      where: { id: Number(id) },
      data,
    });
    logger.info(`IP address updated: ${updated.ip_address}`);
    return updated;
  } catch (error) {
    logger.error(`Failed to update IP with ID ${id}:`, error);
    throw error;
  }
};

const deleteIp = async (id) => {
  try {
    const deleted = await getdb.ipAddress.delete({
      where: { id: Number(id) },
    });
    logger.info(`IP address deleted: ${deleted.ip_address}`);
    return deleted;
  } catch (error) {
    logger.error(`Failed to delete IP with ID ${id}:`, error);
    throw error;
  }
};

module.exports = {
  createIp,
  getAllIps,
  getIpById,
  updateIp,
  deleteIp,
};
