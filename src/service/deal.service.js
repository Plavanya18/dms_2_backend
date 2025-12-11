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

    const newDeal = await getdb.deal.create({
      data: {
        deal_number,
        customer_id: data.customer_id,
        phone_number: data.phone_number,
        deal_type: data.deal_type,
        transaction_mode: data.transaction_mode,
        amount: data.amount,
        rate: data.rate,
        remarks: data.remarks || null,
        status: data.status,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
        received_items: {
          create: (data.received_items || []).map(item => ({
            price: item.price,
            quantity: item.quantity,
            total: item.total,
            currency_id: item.currency_id,
          })),
        },
        paid_items: {
          create: (data.paid_items || []).map(item => ({
            price: item.price,
            quantity: item.quantity,
            total: item.total,
            currency_id: item.currency_id,
          })),
        },
      },
      include: {
        received_items: true,
        paid_items: true,
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
            { received_items: { some: { currency: { code: { contains: currency } } } } },
            { paid_items: { some: { currency: { code: { contains: currency } } } } },
          ]
        : [
            { received_items: { some: { currency: { code: { contains: currency } } } } },
            { paid_items: { some: { currency: { code: { contains: currency } } } } },
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
        received_items: {
          include: { currency: { select: { id: true, code: true, name: true } } },
        },
        paid_items: {
          include: { currency: { select: { id: true, code: true, name: true } } },
        },
        createdBy: { select: { id: true, full_name: true, email: true } },
        actionBy: { select: { id: true, full_name: true, email: true } },
      },
      skip,
      take: limit,
      orderBy: { [orderByField]: orderDirection },
    });

    const dealsWithTotals = deals.map((deal) => {
      const buyAmount = (deal.paid_items || []).reduce(
        (acc, item) => acc + Number(item.total || 0),
        0
      );

      const sellAmount = (deal.received_items || []).reduce(
        (acc, item) => acc + Number(item.total || 0),
        0
      );

      const buyCurrency =
        deal.paid_items?.length > 0 ? deal.paid_items[0].currency.code : null;

      const sellCurrency =
        deal.received_items?.length > 0 ? deal.received_items[0].currency.code : null;

      return {
        ...deal,
        buyAmount,
        sellAmount,
        buyCurrency,
        sellCurrency,
        profit: sellAmount - buyAmount,
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
      include: { received_items: true, paid_items: true },
    });

    const yesterdayDeals = await getdb.deal.findMany({
      where: { created_at: { gte: startYesterday, lte: endYesterday } },
      include: { received_items: true, paid_items: true },
    });

    const calculateTotals = (data) => {
      let buyAmount = 0,
        sellAmount = 0;

      data.forEach((d) => {
        buyAmount += (d.paid_items || []).reduce(
          (sum, item) => sum + Number(item.total || 0),
          0
        );

        sellAmount += (d.received_items || []).reduce(
          (sum, item) => sum + Number(item.total || 0),
          0
        );
      });

      return { buyAmount, sellAmount, profit: sellAmount - buyAmount };
    };

    const today = calculateTotals(todayDeals);
    const yesterday = calculateTotals(yesterdayDeals);

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
      const filePath = await generatePDF(dealsWithTotals);
      return { filePath, stats };
    }

    if (format === "excel") {
      const filePath = await generateExcel(dealsWithTotals);
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

const generateExcel = async (deals) => {
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
    { header: "Rate", key: "rate", width: 10 },
    { header: "Sell Amount", key: "sell_amount", width: 15 },
    { header: "Sell Currency", key: "sell_currency", width: 20 },
    { header: "Status", key: "status", width: 15 },
    { header: "Created At", key: "created_at", width: 20 },
    { header: "Created By", key: "created_by", width: 20 },
  ];

  deals.forEach((d) => {
    const totalReceived = d.received_items.reduce((sum, i) => sum + Number(i.total), 0);
    const totalPaid = d.paid_items.reduce((sum, i) => sum + Number(i.total), 0);

    const buy_amount = d.deal_type === "buy" ? totalPaid : totalReceived;
    const buy_currency =
      d.deal_type === "buy"
        ? d.paid_items.map((i) => `${i.currency.code}(${i.total})`).join(", ")
        : d.received_items.map((i) => `${i.currency.code}(${i.total})`).join(", ");
    const sell_amount = d.deal_type === "buy" ? totalReceived : totalPaid;
    const sell_currency =
      d.deal_type === "buy"
        ? d.received_items.map((i) => `${i.currency.code}(${i.total})`).join(", ")
        : d.paid_items.map((i) => `${i.currency.code}(${i.total})`).join(", ");

    sheet.addRow({
      id: d.id,
      deal_number: d.deal_number,
      deal_type: d.deal_type,
      customer_name: d.customer?.name || "",
      customer_phone: d.customer?.phone_number || "",
      customer_email: d.customer?.email || "",
      buy_amount,
      buy_currency,
      rate: d.rate,
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

const generatePDF = async (deals) => {
  const folder = path.join(__dirname, "../downloads");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);

  const filePath = path.join(folder, `deals_${Date.now()}.pdf`);
  const doc = new PDFDocument({ margin: 40 });

  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(20).text("Deals Report", { underline: true });
  doc.moveDown(1.5);

  deals.forEach((d) => {
    const totalReceived = d.received_items.reduce((sum, i) => sum + Number(i.total), 0);
    const totalPaid = d.paid_items.reduce((sum, i) => sum + Number(i.total), 0);

    const buy_amount = d.deal_type === "buy" ? totalPaid : totalReceived;
    const buy_currency =
      d.deal_type === "buy"
        ? d.paid_items.map(i => `${i.currency?.code || ""} (${i.total})`).join(", ")
        : d.received_items.map(i => `${i.currency?.code || ""} (${i.total})`).join(", ");

    const sell_amount = d.deal_type === "buy" ? totalReceived : totalPaid;
    const sell_currency =
      d.deal_type === "buy"
        ? d.received_items.map(i => `${i.currency?.code || ""} (${i.total})`).join(", ")
        : d.paid_items.map(i => `${i.currency?.code || ""} (${i.total})`).join(", ");

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
    doc.text(`Rate: ${d.rate}`);
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
              received_items: { include: { currency: true } },
              paid_items: { include: { currency: true } },
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

    const updatedDeal = await getdb.deal.update({
      where: { id: Number(id) },
      data: {
        deal_type: data.deal_type,
        transaction_mode: data.transaction_mode,
        amount: data.amount,
        rate: data.rate,
        remarks: data.remarks || null,
        status: data.status,
        action_by: userId,
        action_at: new Date(),
        updated_at: new Date(),

        // Delete existing received_items and create new ones
        received_items: {
          deleteMany: {}, // deletes all existing for this deal
          create: data.received_items.map(item => ({
            price: item.price,
            quantity: item.quantity,
            total: (item.price * item.quantity).toString(),
            currency_id: item.currency_id,
          })),
        },

        // Delete existing paid_items and create new ones
        paid_items: {
          deleteMany: {},
          create: data.paid_items.map(item => ({
            price: item.price,
            quantity: item.quantity,
            total: (item.price * item.quantity).toString(),
            currency_id: item.currency_id,
          })),
        },
      },
      include: {
        received_items: true,
        paid_items: true,
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

