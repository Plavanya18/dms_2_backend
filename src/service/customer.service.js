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
      } else if (searchType === "phone") {
        const cleanSearch = search.replace(/\D/g, "");
        where = {
          phone_number: { contains: cleanSearch },
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
      orderBy: { created_at: "desc" },
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

    const transformedDeals = (customer.deals || []).map((deal) => {
      const isBuy = deal.deal_type === "buy";

      const buyCurrencyCode = deal.buyCurrency?.code || null;
      const sellCurrencyCode = deal.sellCurrency?.code || null;

      const buyAmount = isBuy ? Number(deal.amount || 0) : Number(deal.amount_to_be_paid || 0);
      const sellAmount = isBuy ? Number(deal.amount_to_be_paid || 0) : Number(deal.amount || 0);

      const date = new Date(deal.created_at);
      const formattedDate = `${date.getFullYear()}/${(date.getMonth() + 1)
        .toString()
        .padStart(2, "0")}/${date.getDate().toString().padStart(2, "0")}`;

      return {
        id: deal.id,
        deal_number: deal.deal_number,
        customer_id: deal.customer_id,
        buy_currency_id: deal.buy_currency_id,
        sell_currency_id: deal.sell_currency_id,
        deal_type: isBuy ? "Buy" : "Sell",
        transaction_mode: deal.transaction_mode,
        amount: deal.amount,
        exchange_rate: deal.exchange_rate,
        amount_to_be_paid: deal.amount_to_be_paid,
        remarks: deal.remarks,
        action_reason: deal.action_reason,
        status: deal.status,
        created_by: deal.created_by,
        action_by: deal.action_by,
        action_at: deal.action_at,
        completed_at: deal.completed_at,
        created_at: formattedDate,
        updated_at: deal.updated_at,
        deleted_at: deal.deleted_at,
        receivedItems: deal.receivedItems || [],
        paidItems: deal.paidItems || [],
        buyAmount,
        sellAmount,
        buyCurrency: buyCurrencyCode,
        sellCurrency: sellCurrencyCode,
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
