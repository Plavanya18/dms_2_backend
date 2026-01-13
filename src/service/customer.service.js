const { getdb } = require("../config/db");
const logger = require("../config/logger");

const createCustomer = async (data, userId) => {
  try {
    const existingCustomer = await getdb.customer.findFirst({
      where: {
        OR: [
          { phone_number: data.phone_number },
        ],
      },
    });

    const newCustomer = await getdb.customer.create({
      data: {
        ...data,
        is_active: true,
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
  searchType = "all",
) => {
  try {
    const skip = (page - 1) * limit;

    let where = {};

    if (search) {
      if (searchType === "name") {
        where = {
          name: { contains: search },
          is_active: true,
        };
      } else {
        where = {
          OR: [
            { name: { contains: search } },
            { phone_number: { contains: search } },
            { email: { contains: search } },
          ],
        };
      }
    }

    const total = await getdb.customer.count({ where });

    const customers = await getdb.customer.findMany({
      where,
      skip,
      take: limit,
      include: {
        deals: {
          include: {
            receivedItems: true,
            paidItems: true,
            buyCurrency: { select: { id: true, code: true, name: true } },
            sellCurrency: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    const tzsCurrency = await getdb.currency.findFirst({
      where: { code: "TZS" },
    });

    if (!tzsCurrency) {
      throw new Error("TZS currency not found");
    }

    const currencyRates = await getdb.currencyPairRate.findMany({
      where: { base_currency_id: tzsCurrency.id },
    });

    const rateMap = {};
    for (const r of currencyRates) {
      rateMap[r.quote_currency_id] = Number(r.rate);
    }

    const result = [];

    for (const customer of customers) {
      let creditTZS = 0;
      let debitTZS = 0;

      for (const deal of customer.deals) {
        const rate = rateMap[deal.sell_currency_id];

        const valueTZS = Number(deal.amount_to_be_paid) * rate;

        if (deal.deal_type === "sell") {
          creditTZS += valueTZS;
        } else {
          debitTZS += valueTZS;
        }
      }

      const net = creditTZS - debitTZS;

      result.push({
        ...customer,
        credit: creditTZS.toFixed(2),
        debit: debitTZS.toFixed(2),
        balance: `${Math.abs(net).toFixed(2)}${net >= 0 ? "CR" : "DB"}`,
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
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

const getCustomerById = async (id) => {
  try {
    const customer = await getdb.customer.findUnique({
      where: { id: Number(id) },
      include: {
        createdBy: true,
        deals: {
          include: {
            receivedItems: { include: { currency: true } },
            paidItems: { include: { currency: true } },
            buyCurrency: { select: { id: true, code: true, name: true } },
            sellCurrency: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    if (!customer) return null;

    // Transform deals to include buy/sell totals and currencies
    const transformedDeals = (customer.deals || []).map((deal) => {
      const isBuy = deal.deal_type === "buy";

      // Buy amount & currency
      const buyAmount = (deal.receivedItems || []).reduce(
        (sum, item) => sum + Number(item.total || 0),
        0
      );
      const buyCurrency =
        deal.receivedItems?.length > 0 ? deal.receivedItems[0].currency.code : null;

      // Sell amount & currency
      const sellAmount = (deal.paidItems || []).reduce(
        (sum, item) => sum + Number(item.total || 0),
        0
      );
      const sellCurrency =
        deal.paidItems?.length > 0 ? deal.paidItems[0].currency.code : null;

      // Format date yyyy/mm/dd
      const date = new Date(deal.created_at);
      const formattedDate = `${date.getFullYear()}/${(date.getMonth() + 1)
        .toString()
        .padStart(2, "0")}/${date.getDate().toString().padStart(2, "0")}`;

      return {
        ...deal,
        created_at: formattedDate,
        deal_type: isBuy ? "Buy" : "Sell",
        buyAmount,
        sellAmount,
        buyCurrency,
        sellCurrency,
      };
    });

    return {
      ...customer,
      deals: transformedDeals,
    };
  } catch (error) {
    logger.error(`Failed to fetch customer with deals:`, error);
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
