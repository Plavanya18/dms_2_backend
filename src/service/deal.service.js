const { getdb } = require("../config/db");
const logger = require("../config/logger");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const os = require("os");

const createDeal = async (data, userId) => {
  try {
    const today = new Date();
    const datePart = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;

    const customer = await getdb.customer.findUnique({
      where: { id: data.customer_id },
    });

    if (!customer) {
      throw new Error("Customer not found");
    }

    if (!customer.is_active) {
      throw new Error("Inactive customer cannot create deals");
    }

    const lastDeal = await getdb.deal.findFirst({
      where: {
        deal_number: {
          startsWith: `DL-${datePart}-`
        }
      },
      orderBy: { id: "desc" },
    });

    const lastNumber = lastDeal
      ? parseInt(lastDeal.deal_number.split("-")[2], 10)
      : 0;

    const nextNumber = String(lastNumber + 1).padStart(3, "0");

    const deal_number = `DL-${datePart}-${nextNumber}`;

    logger.info(`Creating deal: ${deal_number}`);

    // const existingPair = await getdb.currencyPairRate.findFirst({
    //   where: {
    //     base_currency_id: data.buy_currency_id,
    //     quote_currency_id: data.sell_currency_id,
    //   },
    // });

    // if (existingPair) {
    //   await getdb.currencyPairRate.update({
    //     where: { id: existingPair.id },
    //     data: {
    //       rate: data.exchange_rate,
    //       effective_at: new Date(),
    //       created_by: userId,
    //     },
    //   });
    // } else {
    //   await getdb.currencyPairRate.create({
    //     data: {
    //       base_currency_id: data.buy_currency_id,
    //       quote_currency_id: data.sell_currency_id,
    //       rate: data.exchange_rate,
    //       effective_at: new Date(),
    //       created_by: userId,
    //     },
    //   });
    // }

    const newDeal = await getdb.deal.create({
      data: {
        deal_number,
        customer_id: data.customer_id,
        phone_number: data.phone_number,
        deal_type: data.deal_type,
        buy_currency_id: data.buy_currency_id,
        sell_currency_id: data.sell_currency_id,
        transaction_mode: data.transaction_mode,
        amount: data.amount,
        exchange_rate: data.exchange_rate,
        amount_to_be_paid: data.amount_to_be_paid,
        remarks: data.remarks || null,
        status: data.status,
        completed_at: data.status === "Completed" ? new Date() : null,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
        receivedItems: {
          create: (data.receivedItems || []).map(item => ({
            price: item.price,
            quantity: item.quantity,
            total: item.total,
            currency_id: item.currency_id,
          })),
        },
        paidItems: {
          create: (data.paidItems || []).map(item => ({
            price: item.price,
            quantity: item.quantity,
            total: item.total,
            currency_id: item.currency_id,
          })),
        },
      },
      include: {
        receivedItems: true,
        paidItems: true,
      },
    });

    logger.info(`Deal created: ${newDeal.deal_number}`);
    return newDeal;
  } catch (error) {
    logger.error("Failed to create deal:", error);
    throw error;
  }
};

const getAllDeals = async (
  page = 1,
  limit = 10,
  search = "",
  status = "",
  currency = "",
  orderByField = "created_at",
  orderDirection = "desc",
  dateFilter = "",
  startDate = "",
  endDate = "",
  format = "",
  userId = null,
  roleName = ""
) => {
  try {
    const skip = (page - 1) * limit;
    const where = {};

    // Search
    if (search) {
      where.OR = [
        { deal_number: { contains: search } },
        { customer: { name: { contains: search } } },
      ];
    }

    if (roleName === "Maker") {
      where.created_by = userId;
    }

    // Status
    if (status) where.status = status;

    // Currency
    if (currency) {
      where.OR = where.OR
        ? [
          ...where.OR,
          { receivedItems: { some: { currency: { code: { contains: currency } } } } },
          { paidItems: { some: { currency: { code: { contains: currency } } } } },
        ]
        : [
          { receivedItems: { some: { currency: { code: { contains: currency } } } } },
          { paidItems: { some: { currency: { code: { contains: currency } } } } },
        ];
    }

    // Date filter
    const now = new Date();
    let fromDate = null;
    if (dateFilter === "today") {
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      where.created_at = { gte: startToday, lte: endToday };
    }
    if (dateFilter === "last7") fromDate = new Date(now.setDate(now.getDate() - 7));
    if (dateFilter === "last30") fromDate = new Date(now.setDate(now.getDate() - 30));
    if (dateFilter === "last90") fromDate = new Date(now.setDate(now.getDate() - 90));
    if (dateFilter === "custom" && startDate && endDate) {
      where.created_at = { gte: new Date(startDate), lte: new Date(endDate) };
    }
    if (fromDate && dateFilter !== "custom") where.created_at = { gte: fromDate };

    // Total count
    const total = await getdb.deal.count({ where });

    // Fetch deals
    const deals = await getdb.deal.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone_number: true, email: true } },
        buyCurrency: { select: { id: true, code: true, name: true } },
        sellCurrency: { select: { id: true, code: true, name: true } },
        receivedItems: { include: { currency: true } },
        paidItems: { include: { currency: true } },
        createdBy: { select: { id: true, full_name: true, email: true } },
        actionBy: { select: { id: true, full_name: true, email: true } },
      },
      skip,
      take: limit,
      orderBy: { [orderByField]: orderDirection },
    });

    // Deactivate inactive customers (older than 15 days)
    const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
    const customerIds = [...new Set(deals.map(d => d.customer_id))];

    for (const customerId of customerIds) {
      const lastDeal = await getdb.deal.findFirst({
        where: { customer_id: customerId },
        orderBy: { created_at: "desc" },
        select: { created_at: true },
      });
      if (!lastDeal) continue;
      const diff = new Date() - new Date(lastDeal.created_at);
      if (diff > FIFTEEN_DAYS) {
        await getdb.customer.update({
          where: { id: customerId },
          data: { is_active: false, updated_at: new Date() },
        });
      }
    }

    // Customers with no deals older than 15 days
    const customersWithoutDeals = await getdb.customer.findMany({
      where: { deals: { none: {} }, is_active: true },
      select: { id: true, created_at: true },
    });

    for (const customer of customersWithoutDeals) {
      const diff = new Date() - new Date(customer.created_at);
      if (diff > FIFTEEN_DAYS) {
        await getdb.customer.update({
          where: { id: customer.id },
          data: { is_active: false, updated_at: new Date() },
        });
      }
    }

    // Map deals with amount_to_be_paid only
    const dealsWithTotals = deals.map(deal => {
      return {
        ...deal,
        amount_to_be_paid: Number(deal.amount_to_be_paid || 0),
      };
    });

    // Function to calculate totals
    const calculateTotals = (dealsArray) => {
      let buyAmount = 0;
      let sellAmount = 0;

      for (const deal of dealsArray) {
        if (deal.deal_type === "buy") sellAmount += Number(deal.amount_to_be_paid || 0);
        if (deal.deal_type === "sell") buyAmount += Number(deal.amount_to_be_paid || 0);
      }

      return {
        buyAmount,
        sellAmount,
        profit: buyAmount - sellAmount,
        count: dealsArray.length,
      };
    };

    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    const startYesterday = new Date(startToday); startYesterday.setDate(startYesterday.getDate() - 1);
    const endYesterday = new Date(startToday); endYesterday.setMilliseconds(-1);

    const statsWhere = { ...where };
    delete statsWhere.created_at;

    const todayDeals = await getdb.deal.findMany({
      where: {
        ...statsWhere,
        created_at: { gte: startToday, lte: endToday }
      }
    });
    const yesterdayDeals = await getdb.deal.findMany({
      where: {
        ...statsWhere,
        created_at: { gte: startYesterday, lte: endYesterday }
      }
    });

    const allMatchingDeals = await getdb.deal.findMany({ where: statsWhere });

    const stats = {
      today: calculateTotals(todayDeals),
      yesterday: calculateTotals(yesterdayDeals),
      total: calculateTotals(allMatchingDeals)
    };

    if (format === "pdf") {
      const filePath = await geneexchange_ratePDF(dealsWithTotals);
      return { filePath, stats };
    }
    if (format === "excel") {
      const filePath = await geneexchange_rateExcel(dealsWithTotals);
      return { filePath, stats };
    }

    return {
      data: dealsWithTotals,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      stats,
    };

  } catch (error) {
    logger.error("Failed to fetch deals:", error);
    throw error;
  }
};

const geneexchange_rateExcel = async (deals) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Deals");

  sheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Deal Number", key: "deal_number", width: 20 },
    { header: "Deal Type", key: "deal_type", width: 15 },
    { header: "Customer Name", key: "customer_name", width: 25 },
    { header: "Customer Phone", key: "customer_phone", width: 20 },
    { header: "Customer Email", key: "customer_email", width: 25 },
    { header: "Buy Amount", key: "buy_amount", width: 15 },
    { header: "Buy Currency", key: "buy_currency", width: 20 },
    { header: "exchange_rate", key: "exchange_rate", width: 10 },
    { header: "Sell Amount", key: "sell_amount", width: 15 },
    { header: "Sell Currency", key: "sell_currency", width: 20 },
    { header: "Status", key: "status", width: 15 },
    { header: "Created At", key: "created_at", width: 20 },
    { header: "Created By", key: "created_by", width: 20 },
  ];

  deals.forEach((d) => {
    const totalReceived = d.receivedItems.reduce((sum, i) => sum + Number(i.total), 0);
    const totalPaid = d.paidItems.reduce((sum, i) => sum + Number(i.total), 0);

    const buy_amount = d.deal_type === "buy" ? totalPaid : totalReceived;
    const buy_currency =
      d.deal_type === "buy"
        ? d.paidItems.map((i) => `${i.currency.code}(${i.total})`).join(", ")
        : d.receivedItems.map((i) => `${i.currency.code}(${i.total})`).join(", ");
    const sell_amount = d.deal_type === "buy" ? totalReceived : totalPaid;
    const sell_currency =
      d.deal_type === "buy"
        ? d.receivedItems.map((i) => `${i.currency.code}(${i.total})`).join(", ")
        : d.paidItems.map((i) => `${i.currency.code}(${i.total})`).join(", ");

    sheet.addRow({
      id: d.id,
      deal_number: d.deal_number,
      deal_type: d.deal_type,
      customer_name: d.customer?.name || "",
      customer_phone: d.customer?.phone_number || "",
      customer_email: d.customer?.email || "",
      buy_amount,
      buy_currency,
      exchange_rate: d.exchange_rate,
      sell_amount,
      sell_currency,
      status: d.status,
      created_at: d.created_at.toISOString(),
      created_by: d.createdBy?.full_name,
    });
  });

  const folder = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(folder)) {
    const backupFolder = path.join(__dirname, "../downloads");
    if (!fs.existsSync(backupFolder)) fs.mkdirSync(backupFolder);
    const filePath = path.join(backupFolder, `deals_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }
  const filePath = path.join(folder, `deals_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  return filePath;
};

const geneexchange_ratePDF = async (deals) => {
  let folder = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(folder)) {
    folder = path.join(__dirname, "../downloads");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  }
  const filePath = path.join(folder, `deals_${Date.now()}.pdf`);
  const doc = new PDFDocument({ margin: 40 });

  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(20).text("Deals Report", { underline: true });
  doc.moveDown(1.5);

  deals.forEach((d) => {
    const totalReceived = d.receivedItems.reduce((sum, i) => sum + Number(i.total), 0);
    const totalPaid = d.paidItems.reduce((sum, i) => sum + Number(i.total), 0);

    const buy_amount = d.deal_type === "buy" ? totalPaid : totalReceived;
    const buy_currency =
      d.deal_type === "buy"
        ? d.paidItems.map(i => `${i.currency?.code || ""} (${i.total})`).join(", ")
        : d.receivedItems.map(i => `${i.currency?.code || ""} (${i.total})`).join(", ");

    const sell_amount = d.deal_type === "buy" ? totalReceived : totalPaid;
    const sell_currency =
      d.deal_type === "buy"
        ? d.receivedItems.map(i => `${i.currency?.code || ""} (${i.total})`).join(", ")
        : d.paidItems.map(i => `${i.currency?.code || ""} (${i.total})`).join(", ");

    const createdAt =
      d.created_at instanceof Date
        ? d.created_at.toISOString()
        : new Date(d.created_at).toISOString();

    doc.fontSize(12).text(`ID: ${d.id}`);
    doc.text(`Deal Number: ${d.deal_number}`);
    doc.text(`Deal Type: ${d.deal_type}`);
    doc.text(`Customer Name: ${d.customer?.name || ""}`);
    doc.text(`Customer Phone: ${d.customer?.phone_number || ""}`);
    doc.text(`Customer Email: ${d.customer?.email || ""}`);
    doc.text(`Buy Amount: ${buy_amount}`);
    doc.text(`Buy Currency: ${buy_currency}`);
    doc.text(`Exchange_rate: ${d.exchange_rate}`);
    doc.text(`Sell Amount: ${sell_amount}`);
    doc.text(`Sell Currency: ${sell_currency}`);
    doc.text(`Status: ${d.status}`);
    doc.text(`Created At: ${createdAt}`);
    doc.text(`Created By: ${d.createdBy?.full_name || ""}`);

    doc.moveDown(1);
    doc.text("----------------------------------------------");
    doc.moveDown(1);
  });

  doc.end();

  return new Promise((resolve) => {
    writeStream.on("finish", () => resolve(filePath));
  });
};

const getDealById = async (id, userId = null, roleName = "") => {
  try {
    const deal = await getdb.deal.findUnique({
      where: { id: Number(id) },
      include: {
        customer: { select: { id: true, name: true, phone_number: true, email: true } },
        receivedItems: { include: { currency: true } },
        paidItems: { include: { currency: true } },
        createdBy: { select: { id: true, full_name: true, email: true } },
        actionBy: { select: { id: true, full_name: true, email: true } },
        buyCurrency: { select: { id: true, code: true, name: true } },
        sellCurrency: { select: { id: true, code: true, name: true } },
      },
    });

    if (deal && roleName === "Maker" && deal.created_by !== userId) {
      throw new Error("Access denied. You can only view your own deals.");
    }

    return deal;

  } catch (error) {
    logger.error(`Failed to fetch deal with ID ${id}:`, error);
    throw error;
  }
};

const updateDealStatus = async (id, status, reason = null, userId) => {
  try {
    const updated = await getdb.deal.update({
      where: { id: Number(id) },
      data: {
        status: status,
        action_by: userId,
        action_reason: reason,
        action_at: new Date(),
        completed_at: status === "Completed" ? new Date() : undefined,
        updated_at: new Date(),
      },
    });

    logger.info(`Deal status updated: ${updated.id} ${updated.deal_number}`);
    return updated;

  } catch (error) {
    logger.error(`Failed to update deal status for ID ${id}:`, error);
    throw error;
  }
};

const updateDeal = async (id, data, userId) => {
  try {
    const existingDeal = await getdb.deal.findUnique({
      where: { id: Number(id) },
    });

    if (!existingDeal) {
      throw new Error("Deal not found");
    }

    const updateData = {
      deal_type: data.deal_type,
      transaction_mode: data.transaction_mode,
      amount: data.amount,
      exchange_rate: data.exchange_rate,
      remarks: data.remarks || null,
      status: data.status,
      action_by: userId,
      action_at: new Date(),
      completed_at: data.status === "Completed" ? new Date() : undefined,
      updated_at: new Date(),
    };

    if (Array.isArray(data.receivedItems)) {
      const incomingIds = data.receivedItems.filter(item => item.id).map(item => Number(item.id));
      const itemsToUpdate = data.receivedItems.filter(item => item.id);
      const itemsToCreate = data.receivedItems.filter(item => !item.id);

      updateData.receivedItems = {
        deleteMany: {
          id: { notIn: incomingIds }
        },
        update: itemsToUpdate.map(item => ({
          where: { id: Number(item.id) },
          data: {
            price: String(item.price),
            quantity: String(item.quantity),
            total: String(item.total),
            currency_id: Number(item.currency_id),
          }
        })),
        create: itemsToCreate.map(item => ({
          price: String(item.price),
          quantity: String(item.quantity),
          total: String(item.total),
          currency_id: Number(item.currency_id),
        }))
      };
    }

    if (Array.isArray(data.paidItems)) {
      const incomingIds = data.paidItems.filter(item => item.id).map(item => Number(item.id));
      const itemsToUpdate = data.paidItems.filter(item => item.id);
      const itemsToCreate = data.paidItems.filter(item => !item.id);

      updateData.paidItems = {
        deleteMany: {
          id: { notIn: incomingIds }
        },
        update: itemsToUpdate.map(item => ({
          where: { id: Number(item.id) },
          data: {
            price: String(item.price),
            quantity: String(item.quantity),
            total: String(item.total),
            currency_id: Number(item.currency_id),
          }
        })),
        create: itemsToCreate.map(item => ({
          price: String(item.price),
          quantity: String(item.quantity),
          total: String(item.total),
          currency_id: Number(item.currency_id),
        }))
      };
    }

    const updatedDeal = await getdb.deal.update({
      where: { id: Number(id) },
      data: updateData,
      include: {
        receivedItems: true,
        paidItems: true,
      },
    });

    logger.info(`Deal updated: ${updatedDeal.deal_number}`);
    return updatedDeal;

  } catch (error) {
    logger.error("Failed to update deal:", error.message);
    throw error;
  }
};

module.exports = {
  createDeal,
  getAllDeals,
  getDealById,
  updateDealStatus,
  updateDeal,
};

