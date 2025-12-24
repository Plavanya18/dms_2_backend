const { getdb } = require("../config/db");
const logger = require("../config/logger");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

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
  format = ""
) => {
  try {
    const skip = (page - 1) * limit;
    const where = {};

    if (search) {
      where.OR = [
        { deal_number: { contains: search } },
        { customer_name: { contains: search } },
      ];
    }

    if (status) {
      where.status = status;
    }

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

    const now = new Date();
    let fromDate = null;

  if (dateFilter === "today") {
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    where.created_at = {
      gte: startToday,
      lte: endToday,
    };
  }

    if (dateFilter === "last7") {
      fromDate = new Date(now.setDate(now.getDate() - 7));
    } else if (dateFilter === "last30") {
      fromDate = new Date(now.setDate(now.getDate() - 30));
    } else if (dateFilter === "last90") {
      fromDate = new Date(now.setDate(now.getDate() - 90));
    } else if (dateFilter === "custom" && startDate && endDate) {
      where.created_at = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    if (fromDate && dateFilter !== "custom") {
      where.created_at = { gte: fromDate };
    }

    const total = await getdb.deal.count({ where });

    const deals = await getdb.deal.findMany({
      where,
      include: {
        customer:{ select:{ id: true, name: true, phone_number: true, email: true} },
        receivedItems: {
          include: { currency: { select: { id: true, code: true, name: true } } },
        },
        paidItems: {
          include: { currency: { select: { id: true, code: true, name: true } } },
        },
        createdBy: { select: { id: true, full_name: true, email: true } },
        actionBy: { select: { id: true, full_name: true, email: true } },
      },
      skip,
      take: limit,
      orderBy: { [orderByField]: orderDirection },
    });

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
          data: {
            is_active: false,
            updated_at: new Date(),
          },
        });
      }
    }

    const customersWithoutDeals = await getdb.customer.findMany({
      where: {
        deals: { none: {} },
        is_active: true,
      },
      select: { id: true, created_at: true },
    });

    for (const customer of customersWithoutDeals) {
      const diff = new Date() - new Date(customer.created_at);

      if (diff > FIFTEEN_DAYS) {
        await getdb.customer.update({
          where: { id: customer.id },
          data: {
            is_active: false,
            updated_at: new Date(),
          },
        });
      }
    }

    const dealsWithTotals = deals.map((deal) => {
      const sellAmount = (deal.paidItems || []).reduce(
        (acc, item) => acc + Number(item.total || 0),
        0
      );

      const buyAmount = (deal.receivedItems || []).reduce(
        (acc, item) => acc + Number(item.total || 0),
        0
      );

      const sellCurrency =
        deal.paidItems?.length > 0 ? deal.paidItems[0].currency.code : null;

      const buyCurrency =
        deal.receivedItems?.length > 0 ? deal.receivedItems[0].currency.code : null;

      return {
        ...deal,
        buyAmount,
        sellAmount,
        buyCurrency,
        sellCurrency,
        profit: buyAmount - sellAmount,
      };
    });

    const endToday = new Date();
    endToday.setHours(23, 59, 59, 999);

    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);

    const endYesterday = new Date(startToday);
    endYesterday.setHours(23, 59, 59, 999);

    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);

    const todayDeals = await getdb.deal.findMany({
      where: { created_at: { gte: startToday, lte: endToday } },
      include: { receivedItems: true, paidItems: true },
    });

    const yesterdayDeals = await getdb.deal.findMany({
      where: { created_at: { gte: startYesterday, lte: endYesterday } },
      include: { receivedItems: true, paidItems: true },
    });

    // get latest currency exchange_rate to INR
    const getLatestexchange_rateToINR = async (currencyCode) => {
      const deal = await getdb.deal.findFirst({
        where: {
          OR: [
            { receivedItems: { some: { currency: { code: currencyCode } } } },
            { paidItems: { some: { currency: { code: currencyCode } } } },
          ],
        },
        orderBy: { created_at: "desc" },
        select: { exchange_rate: true },
      });
      return deal?.exchange_rate ? Number(deal.exchange_rate) : 1;
    };

    const getLatestUsdexchange_rate = async () => {
      const deal = await getdb.deal.findFirst({
        where: {
          OR: [
            { receivedItems: { some: { currency: { code: "USD" } } } },
            { paidItems: { some: { currency: { code: "USD" } } } },
          ],
        },
        orderBy: { created_at: "desc" },
        select: { exchange_rate: true },
      });
      return deal?.exchange_rate ? Number(deal.exchange_rate) : 1;
    };

    const convertToUSD = async (amount, currencyCode, usdexchange_rate) => {
      if (!amount) return 0;

      const exchange_rateToINR = await getLatestexchange_rateToINR(currencyCode);
      const amountInINR = amount * exchange_rateToINR;

      return amountInINR / usdexchange_rate;
    };

    //CALCULATE TOTALS FOR TODAY/YESTERDAY (USD normalized)
    const calculateTotalsUSD = async (dealsArray, usdexchange_rate) => {
      let buyUSD = 0;
      let sellUSD = 0;
    
      for (const deal of dealsArray) {
        for (const item of deal.paidItems || []) {
          const code = item.currency?.code;
          sellUSD += await convertToUSD(Number(item.total || 0), code, usdexchange_rate);
        }
        for (const item of deal.receivedItems || []) {
          const code = item.currency?.code;
          buyUSD += await convertToUSD(Number(item.total || 0), code, usdexchange_rate);
        }
      }
      return {
        buyAmount: Number(buyUSD.toFixed(2)),
        sellAmount: Number(sellUSD.toFixed(2)),
        profit: Number((buyUSD - sellUSD).toFixed(2)),
      };
    };

    const usdexchange_rate = await getLatestUsdexchange_rate();
    const today = await calculateTotalsUSD(todayDeals, usdexchange_rate);
    const yesterday = await calculateTotalsUSD(yesterdayDeals, usdexchange_rate);

    const percentage = (todayVal, yestVal) => {
      if (yestVal === 0) return todayVal > 0 ? 100 : 0;
      return Number((((todayVal - yestVal) / yestVal) * 100).toFixed(2));
    };

    const stats = {
      today: {
        dealCount: todayDeals.length,
        buyAmount: today.buyAmount,
        sellAmount: today.sellAmount,
        profit: today.profit, 
      },
      yesterdayPercentage: {
        dealCount: percentage(todayDeals.length, yesterdayDeals.length),
        buyAmount: percentage(today.buyAmount, yesterday.buyAmount),
        sellAmount: percentage(today.sellAmount, yesterday.sellAmount),
        profit: percentage(today.profit, yesterday.profit),
      },
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

  const folder = path.join(__dirname, "../downloads");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);

  const filePath = path.join(folder, `deals_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  return filePath;
};

const geneexchange_ratePDF = async (deals) => {
  const folder = path.join(__dirname, "../downloads");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);

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

const getDealById = async (id) => {
    try {
        return await getdb.deal.findUnique({
            where: { id: Number(id) },
            include: {
              customer:{ select:{ id: true, name: true, phone_number: true, email: true} },
              receivedItems: { include: { currency: true } },
              paidItems: { include: { currency: true } },
              createdBy: { select: { id: true, full_name: true, email: true } },
              actionBy: { select: { id: true, full_name: true, email: true } },
            },
        });

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
      updated_at: new Date(),
    };

    if (Array.isArray(data.receivedItems)) {
      updateData.receivedItems = {
        deleteMany: {},
        create: data.receivedItems.map(item => ({
          price: item.price,
          quantity: item.quantity,
          total: item.total,
          currency_id: item.currency_id,
        })),
      };
    }

    if (Array.isArray(data.paidItems)) {
      updateData.paidItems = {
        deleteMany: {},
        create: data.paidItems.map(item => ({
          price: item.price,
          quantity: item.quantity,
          total: item.total,
          currency_id: item.currency_id,
        })),
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

