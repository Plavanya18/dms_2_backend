const { getdb } = require("../config/db");
const logger = require("../config/logger");

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
      include: { createdBy: true, deals: true },
    });

    return {
      data: customers,
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
    logger.error("Failed to fetch customers:", error);
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
