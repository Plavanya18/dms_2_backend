const { getdb } = require("../config/db");
const logger = require("../config/logger");

const createDealStatus = async (data) => {
  try {
    const { name } = data;

    const existing = await getdb.dealStatus.findUnique({ where: { name } });
    if (existing) throw new Error("Deal Status name already exists");

    const created = await getdb.dealStatus.create({
      data: { 
        name: data.name,
        created_at: new Date(),
       },
    });

    logger.info(`DealStatus created: ${created.name}`);
    return created;
  } catch (error) {
    logger.error("Failed to create DealStatus:", error);
    throw error;
  }
};

const updateDealStatus = async (id, data) => {
  try {
    const updated = await getdb.dealStatus.update({
      where: { id: Number(id) },
      data: { name: data.name },
    });

    logger.info(`DealStatus updated: ${updated.name}`);
    return updated;
  } catch (error) {
    logger.error(`Failed to update DealStatus with ID ${id}:`, error);
    throw error;
  }
};

const getDealStatusById = async (id) => {
  try {
    const dealStatus = await getdb.dealStatus.findUnique({
      where: { id: Number(id) },
    });

    return dealStatus;
  } catch (error) {
    logger.error(`Failed to fetch DealStatus with ID ${id}:`, error);
    throw error;
  }
};

const getDealStatusList = async () => {
  try {
    const list = await getdb.dealStatus.findMany({
      orderBy: { id: "asc" },
    });

    return list;
  } catch (error) {
    logger.error("Failed to list DealStatus:", error);
    throw error;
  }
};

const deleteDealStatus = async (id) => {
  try {
    const deleted = await getdb.dealStatus.delete({
      where: { id: Number(id) },
    });

    logger.info(`DealStatus deleted: ${deleted.name}`);
    return deleted;
  } catch (error) {
    logger.error(`Failed to delete DealStatus with ID ${id}:`, error);
    throw error;
  }
};


const createreconciliationStatus = async (data) => {
  try {
    const { name } = data;

    const existing = await getdb.reconciliationStatus.findUnique({
       where: { 
        name: data.name,
      } 
    });
    if (existing) throw new Error("recoincilation Status name already exists");

    const created = await getdb.reconciliationStatus.create({
      data: { 
        name: data.name,
        created_at: new Date(),
        updated_at: new Date(), 
       },
    });

    logger.info(`reconciliationStatus created: ${created.name}`);
    return created;
  } catch (error) {
    logger.error("Failed to create reconciliationStatus:", error);
    throw error;
  }
};

const updatereconciliationStatus = async (id, data) => {
  try {
    const updated = await getdb.reconciliationStatus.update({
      where: { id: Number(id) },
      data: { 
        name: data.name,
        updated_at: new Date(),
       },
    });

    logger.info(`reconciliationStatus updated: ${updated.name}`);
    return updated;
  } catch (error) {
    logger.error(`Failed to update reconciliationStatus with ID ${id}:`, error);
    throw error;
  }
};

const getreconciliationStatusById = async (id) => {
  try {
    const reconciliationStatus = await getdb.reconciliationStatus.findUnique({
      where: { id: Number(id) },
    });

    return reconciliationStatus;
  } catch (error) {
    logger.error(`Failed to fetch reconciliationStatus with ID ${id}:`, error);
    throw error;
  }
};

const getreconciliationStatusList = async () => {
  try {
    const list = await getdb.reconciliationStatus.findMany({
      orderBy: { id: "asc" },
    });

    return list;
  } catch (error) {
    logger.error("Failed to list reconciliationStatus:", error);
    throw error;
  }
};

const deletereconciliationStatus = async (id) => {
  try {
    const deleted = await getdb.reconciliationStatus.delete({
      where: { id: Number(id) },
    });

    logger.info(`reconciliationStatus deleted: ${deleted.name}`);
    return deleted;
  } catch (error) {
    logger.error(`Failed to delete reconciliationStatus with ID ${id}:`, error);
    throw error;
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
