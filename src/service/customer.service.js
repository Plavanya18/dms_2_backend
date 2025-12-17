const { getdb } = require("../config/db");
const logger = require("../config/logger");
const { convertDealToUSD, buildCurrencyMaps } = require("../utils/currencyConverter");
const { getLatestUsdRateToINR } = require("./currency.service");

const createCustomer = async (data, userId) => {
  try {
    const newCustomer = await getdb.customer.create({
      data: {
        ...data,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    logger.info(`Customer created: ${newCustomer.id} - ${newCustomer.name}`);
    return newCustomer;
  } catch (error) {
    logger.error("Failed to create customer:", error);
    throw error;
  }
};

const getAllCustomers = async (
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
            { name: { contains: search } },
            { phone_number: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : {};

    const total = await getdb.customer.count({ where });

    const customers = await getdb.customer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [orderByField]: orderDirection },
      include: {
        deals: {
          include: {
            received_items: {
              include: { currency: true },
            },
            paid_items: {
              include: { currency: true },
            },
          },
        },
      },
    });

    const { idToCode, codeToId } = await buildCurrencyMaps();
    const usdInrRate = await getLatestUsdRateToINR(codeToId);

    const result = [];

    for (const customer of customers) {
      let creditUSD = 0;
      let debitUSD = 0;

      for (const deal of customer.deals) {
        const usdAmount = await convertDealToUSD(
          deal,
          idToCode,
          usdInrRate
        );

        if (deal.deal_type === "sell") {
          creditUSD += usdAmount;
        } else {
          debitUSD += usdAmount;
        }
      }

      const net = creditUSD - debitUSD;

      result.push({
        ...customer,
        balance: `${Math.abs(net).toFixed(2)}${net >= 0 ? "CR" : "DB"}`,
        creditUSD: creditUSD.toFixed(2),
        debitUSD: debitUSD.toFixed(2),
      });
    }

    return {
      data: result,
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
    throw error;
  }
};

const getCustomerById = async (id) => {
  try {
    const customer = await getdb.customer.findUnique({
      where: { id: Number(id) },
      include: { createdBy: true, deals: true },
    });

    if (!customer) {
      logger.warn(`Customer not found with ID: ${id}`);
      return null;
    }

    return customer;
  } catch (error) {
    logger.error(`Failed to fetch customer with ID ${id}:`, error);
    throw error;
  }
};

const updateCustomer = async (id, data) => {
  try {
    const updatedCustomer = await getdb.customer.update({
      where: { id: Number(id) },
      data: {
        ...data,
        updated_at: new Date(),
      },
    });

    logger.info(`Customer updated: ${updatedCustomer.id} - ${updatedCustomer.name}`);
    return updatedCustomer;
  } catch (error) {
    logger.error(`Failed to update customer with ID ${id}:`, error);
    throw error;
  }
};

const deleteCustomer = async (id) => {
  try {
    const deletedCustomer = await getdb.customer.delete({
      where: { id: Number(id) },
    });

    logger.info(`Customer deleted: ${deletedCustomer.id} - ${deletedCustomer.name}`);
    return deletedCustomer;
  } catch (error) {
    logger.error(`Failed to delete customer with ID ${id}:`, error);
    throw error;
  }
};

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};
