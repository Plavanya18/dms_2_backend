const { email } = require("../config/config");
const { getdb } = require("../config/db");
const logger = require("../config/logger");

const createCurrency = async (data) => {
  try {
    const newCurrency = await getdb.currency.create({
      data: {
        code: data.code,
        name: data.name,
        symbol: data.symbol,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    logger.info(`Currency created: ${newCurrency.code}`);
    return newCurrency;
  } catch (error) {
    logger.error("Failed to create currency:", error);
    throw error;
  }
};

const getAllCurrencies = async (page = 1, limit = 10, search = "", orderByField = "created_at", orderDirection = "desc") => {
  try {
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { code: { contains: search} },
            { name: { contains: search} },
          ],
        }
      : {};

    const total = await getdb.currency.count({ where });

    const currencies = await getdb.currency.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [orderByField]: orderDirection },
    });

    return {
      data: currencies,
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
    logger.error("Failed to fetch currencies:", error);
    throw error;
  }
};

const getCurrencyById = async (id) => {
  try {
    const currency = await getdb.currency.findUnique({
      where: { id: Number(id) },
    });
    return currency;
  } catch (error) {
    logger.error(`Failed to fetch currency with ID ${id}:`, error);
    throw error;
  }
};

const updateCurrency = async (id, data) => {
  try {
    const updated = await getdb.currency.update({
      where: { id: Number(id) },
      data: {
        ...data,
        updated_at: new Date(),
      },
    });

    logger.info(`Currency updated: ${updated.code}`);
    return updated;
  } catch (error) {
    logger.error(`Failed to update currency with ID ${id}:`, error);
    throw error;
  }
};


const deleteCurrency = async (id) => {
  try {
    const deleted = await getdb.currency.delete({
      where: { id: Number(id) },
    });
    logger.info(`Currency deleted: ${deleted.code}`);
    return deleted;
  } catch (error) {
    logger.error(`Failed to delete currency with ID ${id}:`, error);
    throw error;
  }
};

module.exports = {
  createCurrency,
  getAllCurrencies,
  getCurrencyById,
  updateCurrency,
  deleteCurrency,
};
