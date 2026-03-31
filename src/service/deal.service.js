const { getdb } = require("../config/db");
const logger = require("../config/logger");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const os = require("os");

const createDeal = async (data, userId) => {
  try {
    const pre_date = (data.pre_date && !isNaN(Date.parse(data.pre_date)))
      ? new Date(data.pre_date)
      : (data.created_at && !isNaN(Date.parse(data.created_at)))
        ? new Date(data.created_at)
        : new Date();

    // Set created_at to current time for audit, unless explicitly provided as different from pre_date
    const createdAt = new Date();

    const datePart = `${String(pre_date.getUTCDate()).padStart(2, "0")}${String(pre_date.getUTCMonth() + 1).padStart(2, "0")}`;

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

    const newDeal = await getdb.deal.create({
      data: {
        deal_number,
        customer_id: data.customer_id,
        deal_type: data.deal_type,
        buy_currency_id: data.buy_currency_id,
        sell_currency_id: data.sell_currency_id,
        transaction_mode: data.transaction_mode,
        amount: data.amount,
        exchange_rate: data.exchange_rate,
        amount_to_be_paid: data.amount_to_be_paid,
        remarks: data.remarks || null,
        credit_type: data.credit_type || null,
        status: data.status,
        completed_at: data.status === "Completed" ? createdAt : null,
        created_by: userId,
        created_at: createdAt,
        updated_at: createdAt,
        pre_date: pre_date,
        receivedItems: {
          create: (data.receivedItems || []).map(item => ({
            price: String(item.price),
            quantity: String(item.quantity),
            total: String(item.total),
            currency_id: Number(item.currency_id),
            created_at: pre_date, // Align items with pre_date for reconciliation mapping
          })),
        },
        paidItems: {
          create: (data.paidItems || []).map(item => ({
            price: String(item.price),
            quantity: String(item.quantity),
            total: String(item.total),
            currency_id: Number(item.currency_id),
            created_at: pre_date, // Align items with pre_date for reconciliation mapping
          })),
        },
      },
      include: {
        receivedItems: true,
        paidItems: true,
      },
    });

    logger.info(`Deal created: ${newDeal.deal_number}`);

    // Map to reconciliation of the pre_date if it exists
    try {
      const { syncReconciliationCascade } = require("./reconciliation.service");

      const startOfDay = new Date(pre_date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(pre_date);
      endOfDay.setHours(23, 59, 59, 999);

      // Find the reconciliation for that specific pre_date
      const reconciliation = await getdb.reconciliation.findFirst({
        where: {
          created_at: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        orderBy: { created_at: "asc" },
      });

      if (reconciliation) {
        await getdb.reconciliationDeal.create({
          data: {
            reconciliation_id: reconciliation.id,
            deal_id: newDeal.id,
          },
        });
        logger.info(`Automatically mapped deal ${newDeal.deal_number} to reconciliation ${reconciliation.id}`);

        // Trigger cascading update from this date onwards
        await syncReconciliationCascade(pre_date, userId);
      }
    } catch (mappingError) {
      logger.error("Failed to automatically map deal or sync cascade:", mappingError);
    }

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
  orderByField = "pre_date",
  orderDirection = "desc",
  dateFilter = "",
  startDate = "",
  endDate = "",
  format = "",
  customer_id = "",
  dealType = "",
  userId = null,
  roleName = "",
  userOnly = false
) => {
  try {
    const skip = (page - 1) * limit;
    const where = { deleted_at: null };
    const now = new Date();

    // Search
    if (search) {
      where.OR = [
        { deal_number: { contains: search } },
        { customer: { name: { contains: search } } },
      ];
    }

    // Role-based filtering: only filter by creator when explicitly requested (userOnly mode)
    if (userOnly && userId) {
      where.created_by = Number(userId);
    }

    // Status Filter
    if (status && status !== "All Status") {
      where.status = status;
    }

    // Currency Filter (Applied as AND with other filters)
    if (currency && currency !== "All Currencies") {
      const currencyFilter = {
        OR: [
          { buyCurrency: { code: { contains: currency } } },
          { sellCurrency: { code: { contains: currency } } },
        ],
      };
      if (where.AND) {
        where.AND.push(currencyFilter);
      } else {
        where.AND = [currencyFilter];
      }
    }

    if (customer_id) {
      where.customer_id = Number(customer_id);
    }

    if (dealType && dealType !== "All") {
      where.deal_type = dealType.toLowerCase();
    }

    if (dateFilter) {
      let dateCondition = {};
      if (dateFilter === "today") {
        const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        const endToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
        dateCondition = {
          OR: [
            { pre_date: { gte: startToday, lte: endToday } },
            { pre_date: null, created_at: { gte: startToday, lte: endToday } }
          ]
        };
      } else if (dateFilter === "last7") {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7, 0, 0, 0, 0));
        dateCondition = {
          OR: [
            { pre_date: { gte: d } },
            { pre_date: null, created_at: { gte: d } }
          ]
        };
      } else if (dateFilter === "last30") {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30, 0, 0, 0, 0));
        dateCondition = {
          OR: [
            { pre_date: { gte: d } },
            { pre_date: null, created_at: { gte: d } }
          ]
        };
      } else if (dateFilter === "last90") {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 90, 0, 0, 0, 0));
        dateCondition = {
          OR: [
            { pre_date: { gte: d } },
            { pre_date: null, created_at: { gte: d } }
          ]
        };
      } else if (dateFilter === "custom" && startDate && endDate) {
        const s = new Date(startDate);
        const start = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 0, 0, 0, 0));
        const e = new Date(endDate);
        const end = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate(), 23, 59, 59, 999));
        dateCondition = {
          OR: [
            { pre_date: { gte: start, lte: end } },
            { pre_date: null, created_at: { gte: start, lte: end } }
          ]
        };
      }

      if (Object.keys(dateCondition).length > 0) {
        if (where.AND) where.AND.push(dateCondition);
        else where.AND = [dateCondition];
      }
    }

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
      skip: (format === "pdf" || format === "excel") ? undefined : skip,
      take: (format === "pdf" || format === "excel") ? undefined : limit,
      orderBy: { [orderByField]: orderDirection },
    });

    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);

    const endToday = new Date();
    endToday.setHours(23, 59, 59, 999);

    // Always fetch the shared (all-user) reconciliation for opening balance stats
    const reconciliationWhere = {};

    const reconciliations = await getdb.reconciliation.findMany({
      where: reconciliationWhere,
      orderBy: { created_at: "desc" },
      take: 2,
      include: {
        openingEntries: { include: { currency: { select: { code: true } } } },
        closingEntries: { include: { currency: { select: { code: true } } } },
        deals: {
          include: {
            deal: {
              include: {
                receivedItems: { include: { currency: { select: { code: true } } } },
                paidItems: { include: { currency: { select: { code: true } } } }
              }
            }
          }
        }
      }
    });

    let todayRecon = null;
    let yesterdayRecon = null;

    if (reconciliations.length > 0) {
      const firstDate = new Date(reconciliations[0].created_at);
      if (firstDate >= startToday && firstDate <= endToday) {
        todayRecon = reconciliations[0];
        yesterdayRecon = reconciliations[1];
      } else {
        yesterdayRecon = reconciliations[0];
      }
    }

    let openingBalances = {};

    if (yesterdayRecon) {
      if (yesterdayRecon.status === "Tallied") {
        if (todayRecon) {
          todayRecon.openingEntries.forEach(e => {
            const code = e.currency.code;
            openingBalances[code] = (openingBalances[code] || 0) + Number(e.amount || 0);
          });
        }
      } else if (yesterdayRecon.status === "Excess") {
        yesterdayRecon.closingEntries.forEach(e => {
          const code = e.currency.code;
          openingBalances[code] = (openingBalances[code] || 0) + Number(e.amount || 0);
        });
        if (todayRecon) {
          todayRecon.openingEntries.forEach(e => {
            const code = e.currency.code;
            openingBalances[code] = (openingBalances[code] || 0) + Number(e.amount || 0);
          });
        }
      } else if (yesterdayRecon.status === "Short") {
        // Calculate Yesterday's Shortages for ALL currencies
        let yExpected = {};
        let yActual = {};

        yesterdayRecon.openingEntries.forEach(e => {
          const code = e.currency.code;
          yExpected[code] = (yExpected[code] || 0) + Number(e.amount || 0);
        });

        yesterdayRecon.deals.forEach(rd => {
          const d = rd.deal;
          if (!d) return;
          (d.receivedItems || []).forEach(item => {
            const code = item.currency.code;
            yExpected[code] = (yExpected[code] || 0) + Number(item.total || 0);
          });
          (d.paidItems || []).forEach(item => {
            const code = item.currency.code;
            yExpected[code] = (yExpected[code] || 0) - Number(item.total || 0);
          });
        });

        yesterdayRecon.closingEntries.forEach(e => {
          const code = e.currency.code;
          yActual[code] = (yActual[code] || 0) + Number(e.amount || 0);
        });

        if (todayRecon) {
          todayRecon.openingEntries.forEach(e => {
            const code = e.currency.code;
            openingBalances[code] = (openingBalances[code] || 0) + Number(e.amount || 0);
          });
        }

        // Apply shortages
        Object.keys(yExpected).forEach(code => {
          const short = Math.max(0, (yExpected[code] || 0) - (yActual[code] || 0));
          openingBalances[code] = (openingBalances[code] || 0) - short;
        });
      } else {
        const entries = todayRecon ? todayRecon.openingEntries : yesterdayRecon.closingEntries;
        entries.forEach(e => {
          const code = e.currency.code;
          openingBalances[code] = (openingBalances[code] || 0) + Number(e.amount || 0);
        });
      }
    } else if (todayRecon) {
      todayRecon.openingEntries.forEach(e => {
        const code = e.currency.code;
        openingBalances[code] = (openingBalances[code] || 0) + Number(e.amount || 0);
      });
    }

    // =========================
    // DEAL TOTAL CALCULATION
    // =========================

    const dealsWithTotals = deals.map((deal) => ({
      ...deal,
      amount: Number(deal.amount || 0),
      amount_to_be_paid: Number(deal.amount_to_be_paid || 0),
    }));

    const calculateTotals = (dealsArray) => {
      let currencies = {};

      for (const deal of dealsArray) {
        const amount = Number(deal.amount || 0);
        const amountToBePaid = Number(deal.amount_to_be_paid || 0);

        const buyCode = deal.buyCurrency?.code;
        const sellCode = deal.sellCurrency?.code;

        if (deal.deal_type === "buy") {
          if (buyCode) {
            if (!currencies[buyCode]) currencies[buyCode] = { buy: 0, sell: 0 };
            currencies[buyCode].buy += amount;
          }
          if (sellCode) {
            if (!currencies[sellCode]) currencies[sellCode] = { buy: 0, sell: 0 };
            currencies[sellCode].sell += amountToBePaid;
          }
        }

        if (deal.deal_type === "sell") {
          if (sellCode) {
            if (!currencies[sellCode]) currencies[sellCode] = { buy: 0, sell: 0 };
            currencies[sellCode].sell += amount;
          }
          if (buyCode) {
            if (!currencies[buyCode]) currencies[buyCode] = { buy: 0, sell: 0 };
            currencies[buyCode].buy += amountToBePaid;
          }
        }
      }

      return {
        currencies,
        count: dealsArray.length,
      };
    };

    const allDealsForStats = await getdb.deal.findMany({
      where,
      include: {
        buyCurrency: { select: { code: true } },
        sellCurrency: { select: { code: true } },
      },
    });

    const todayDeals = allDealsForStats.filter(
      (d) =>
        new Date(d.pre_date || d.created_at) >= startToday &&
        new Date(d.pre_date || d.created_at) <= endToday
    );

    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);

    const endYesterday = new Date(startToday);
    endYesterday.setMilliseconds(-1);

    const yesterdayDeals = allDealsForStats.filter(
      (d) =>
        new Date(d.pre_date || d.created_at) >= startYesterday &&
        new Date(d.pre_date || d.created_at) <= endYesterday
    );

    const stats = {
      today: {
        ...calculateTotals(todayDeals),
        openingBalances,
      },
      yesterday: calculateTotals(yesterdayDeals),
    };

    if (format === "pdf") {
      let downloadingUser = null;
      if (userId) {
        downloadingUser = await getdb.user.findUnique({
          where: { id: Number(userId) },
          select: { full_name: true, phone_number: true, email: true }
        });
      }
      const filePath = await generateDealsPDF(dealsWithTotals, { startDate, endDate, user: downloadingUser });
      return { filePath, stats };
    }

    if (format === "excel") {
      const filePath = await generateDealsExcel(dealsWithTotals);
      return { filePath, stats };
    }

    return {
      data: dealsWithTotals,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats,
    };
  } catch (error) {
    logger.error("Failed to fetch deals:", error);
    throw error;
  }
};

const capitalizeWords = (str = "") => {
  return str
    .toLowerCase()
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const formatDateDDMMYYYY = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

const generateDealsExcel = async (deals) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Deals");

  sheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Deal Number", key: "deal_number", width: 20 },
    { header: "Deal Type", key: "deal_type", width: 15 },
    { header: "Customer Name", key: "customer_name", width: 25 },
    { header: "Currency Pair", key: "currency_pair", width: 20 },
    { header: "Buy Amount", key: "buy_amount", width: 15 },
    { header: "Exchange Rate", key: "exchange_rate", width: 15 },
    { header: "Sell Amount", key: "sell_amount", width: 15 },
    { header: "Status", key: "status", width: 15 },
    { header: "Date", key: "created_at", width: 20 },
    { header: "Created By", key: "created_by", width: 20 },
  ];

  deals.forEach((d) => {
    const isBuy = d.deal_type === "buy";
    const buyCurr = d.buyCurrency?.code || "";
    const sellCurr = d.sellCurrency?.code || "";
    const pair = isBuy ? `${buyCurr}/${sellCurr}` : `${sellCurr}/${buyCurr}`;

    const buy_amount = isBuy
      ? `${Number(d.amount || 0).toLocaleString()}`
      : `${Number(d.amount_to_be_paid || 0).toLocaleString()}`;
    const sell_amount = isBuy
      ? `${Number(d.amount_to_be_paid || 0).toLocaleString()}`
      : `${Number(d.amount || 0).toLocaleString()}`;

    sheet.addRow({
      id: d.id,
      deal_number: d.deal_number,
      deal_type: capitalizeWords(d.deal_type),
      customer_name: d.customer?.name || "",
      currency_pair: pair,
      buy_amount,
      exchange_rate: Number(d.exchange_rate || 0),
      sell_amount,
      status: d.status,
      created_at: formatDateDDMMYYYY(d.pre_date || d.created_at),
      created_by: capitalizeWords(d.createdBy?.full_name || ""),
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

const generateDealsPDF = async (deals, options = {}) => {
  let folder = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(folder)) {
    folder = path.join(__dirname, "../downloads");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  }
  const filePath = path.join(folder, `deals_report_${Date.now()}.pdf`);
  const doc = new PDFDocument({ margin: 30, size: "A4", layout: "portrait" });

  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  const PRIMARY_COLOR = "#1D4CB5";
  const TEXT_COLOR = "#333333";
  const SECONDARY_TEXT = "#666666";
  const BORDER_COLOR = "#EEEEEE";
  const WHITE = "#FFFFFF";

  const { startDate, endDate } = options;
  const dateRangeStr = startDate && endDate 
    ? `From ${formatDateDDMMYYYY(startDate)} To ${formatDateDDMMYYYY(endDate)}`
    : `Generated on ${new Date().toLocaleDateString()}`;

  const drawHeader = () => {
    doc.rect(0, 0, doc.page.width, 8).fill(PRIMARY_COLOR);

    const drawUsoftLogo = (docInst, x, y, size = 42) => {
      const scale = size / 16;
      docInst.save();
      docInst.translate(x, y);
      docInst.scale(scale);
      const grad = docInst.linearGradient(8, 0, 8, 16);
      grad.stop(0, "#07122A");
      grad.stop(1, "#123FA2");
      docInst.roundedRect(0, 0, 16, 16, 2).fill(grad);
      docInst.path("M5.67578 3.33203V8.6377C5.6759 9.11929 5.78028 9.54823 5.99023 9.92285C6.20439 10.2974 6.50561 10.5916 6.89258 10.8057C7.27973 11.0198 7.73129 11.127 8.24609 11.127C8.76481 11.1269 9.21572 11.0197 9.59863 10.8057C9.98565 10.5916 10.2851 10.2975 10.4951 9.92285C10.7092 9.54823 10.8163 9.11929 10.8164 8.6377V5.88965L13.4912 7.2207V8.86621C13.4911 9.78858 13.2707 10.5963 12.8301 11.2881C12.3935 11.9798 11.7816 12.5191 10.9951 12.9062C10.2085 13.2892 9.29206 13.4814 8.24609 13.4814C7.19582 13.4814 6.27693 13.2893 5.49023 12.9062C4.70371 12.5192 4.09187 11.9798 3.65527 11.2881C3.21877 10.5963 3.00012 9.78858 3 8.86621V2L5.67578 3.33203Z").fill("white");
      docInst.rect(8.53259, 3.57251, 2.32942, 2.32942).fill("#5761D7");
      docInst.rect(10.8619, 2.29102, 1.28118, 1.28118).fill("#DA0404");
      docInst.restore();
    };

    drawUsoftLogo(doc, 30, 30);

    doc.fillColor(TEXT_COLOR).fontSize(18).font("Helvetica-Bold").text("Usoft", 80, 40);

    const { user } = options;
    const downloaderName = (user?.full_name || "");
    const downloaderPhone = user?.phone_number || "";
    const downloaderEmail = user?.email || "";

    const rightAlignX = doc.page.width - 230;
    doc.fillColor(SECONDARY_TEXT).fontSize(8).font("Helvetica");
    if (downloaderName) doc.text(`Generated by: ${downloaderName}`, rightAlignX, 35, { align: "right", width: 200 });
    if (downloaderPhone) doc.text(`Phone: ${downloaderPhone}`, rightAlignX, 48, { align: "right", width: 200 });
    if (downloaderEmail) doc.text(`Email: ${downloaderEmail}`, rightAlignX, 61, { align: "right", width: 200 });

    doc.moveTo(30, 85).lineTo(doc.page.width - 30, 85).strokeColor(BORDER_COLOR).stroke();
  };

  drawHeader();

  doc.fillColor(TEXT_COLOR).fontSize(14).font("Helvetica-Bold").text("Deals Report", 30, 100);
  doc.fontSize(8).font("Helvetica").fillColor(SECONDARY_TEXT).text(dateRangeStr, 30, 120);

  const COLUMN_WIDTHS = {
    dealNo: 60,
    type: 55,
    customer: 70,
    pair: 70,
    buyAmt: 60,
    rate: 30,
    sellAmt: 60,
    status: 40,
    date: 45,
    creator: 45
  };

  const drawTableHeader = (y) => {
    doc.rect(30, y, 535, 25).fill(PRIMARY_COLOR);
    doc.fillColor(WHITE).fontSize(7).font("Helvetica-Bold");
    let currentX = 35;
    doc.text("Deal No.", currentX, y + 9);
    currentX += COLUMN_WIDTHS.dealNo;
    doc.text("Deal Type", currentX, y + 9);
    currentX += COLUMN_WIDTHS.type;
    doc.text("Customer", currentX, y + 9);
    currentX += COLUMN_WIDTHS.customer;
    doc.text("Currency Pair", currentX, y + 9);
    currentX += COLUMN_WIDTHS.pair;
    doc.text("Buy Amount", currentX, y + 9);
    currentX += COLUMN_WIDTHS.buyAmt;
    doc.text("Rate", currentX, y + 9);
    currentX += COLUMN_WIDTHS.rate;
    doc.text("Sell Amount", currentX, y + 9);
    currentX += COLUMN_WIDTHS.sellAmt;
    doc.text("Status", currentX, y + 9);
    currentX += COLUMN_WIDTHS.status;
    doc.text("Date", currentX, y + 9);
    currentX += COLUMN_WIDTHS.date;
    doc.text("Created By", currentX, y + 9);
  };

  let currentY = 145;
  drawTableHeader(currentY);
  currentY += 30;

  deals.forEach((d, index) => {
    if (currentY > 750) {
      doc.addPage();
      currentY = 40;
      drawTableHeader(currentY);
      currentY += 30;
    }

    const isBuy = d.deal_type === "buy";
    const buyCurr = d.buyCurrency?.code || "";
    const sellCurr = d.sellCurrency?.code || "";
    const pair = isBuy ? `${buyCurr}/${sellCurr}` : `${sellCurr}/${buyCurr}`;
    const bAmt = isBuy ? Number(d.amount || 0) : Number(d.amount_to_be_paid || 0);
    const sAmt = isBuy ? Number(d.amount_to_be_paid || 0) : Number(d.amount || 0);

    doc.fillColor(TEXT_COLOR).fontSize(7).font("Helvetica");
    if (index % 2 === 1) {
      doc.rect(30, currentY - 4, 535, 18).fill("#F7F9FF");
      doc.fillColor(TEXT_COLOR);
    }

    let currentX = 35;
    doc.text(d.deal_number, currentX, currentY);
    currentX += COLUMN_WIDTHS.dealNo;
    doc.text(capitalizeWords(d.deal_type), currentX, currentY);
    currentX += COLUMN_WIDTHS.type;
    doc.text(d.customer?.name || "N/A", currentX, currentY, { width: COLUMN_WIDTHS.customer - 5 });
    currentX += COLUMN_WIDTHS.customer;
    doc.text(pair, currentX, currentY);
    currentX += COLUMN_WIDTHS.pair;
    doc.text(bAmt.toLocaleString(), currentX, currentY);
    currentX += COLUMN_WIDTHS.buyAmt;
    doc.text(Number(d.exchange_rate || 0).toLocaleString(), currentX, currentY);
    currentX += COLUMN_WIDTHS.rate;
    doc.text(sAmt.toLocaleString(), currentX, currentY);
    currentX += COLUMN_WIDTHS.sellAmt;
    doc.text(d.status, currentX, currentY);
    currentX += COLUMN_WIDTHS.status;
    doc.text(formatDateDDMMYYYY(d.pre_date || d.created_at), currentX, currentY);
    currentX += COLUMN_WIDTHS.date;
    doc.text(d.createdBy?.full_name?.split(" ")[0] || "N/A", currentX, currentY);

    currentY += 18;
  });

  const drawFooter = (docInst) => {
    const footerY = docInst.page.height - 80;
    docInst.moveTo(30, footerY).lineTo(docInst.page.width - 30, footerY).strokeColor(BORDER_COLOR).stroke();
    docInst.fillColor(TEXT_COLOR).fontSize(9).font("Helvetica-Bold").text("Terms & Conditions :", 30, footerY + 10);
    docInst.fillColor(SECONDARY_TEXT).fontSize(7).font("Helvetica");
    docInst.text("1. All transactions are final and subject to local financial regulations.", 30, footerY + 22);
    docInst.text("2. Please verify all details before leaving the counter.", 30, footerY + 34);
    docInst.text("3. DMS 2 is not responsible for errors in provided account details.", 30, footerY + 46);
    docInst.fontSize(7).text(`Page ${docInst.bufferedPageRange().count}`, docInst.page.width - 60, footerY + 55);
  };

  let pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc);
  }

  doc.end();

  return new Promise((resolve) => {
    writeStream.on("finish", () => resolve(filePath));
  });
};

const getDealById = async (id, roleName = "") => {
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

    // Trigger cascading sync if status changed (valuation/movement might be affected)
    try {
      const { syncReconciliationCascade } = require("./reconciliation.service");
      if (updated.pre_date) {
        await syncReconciliationCascade(updated.pre_date, userId);
      }
    } catch (syncError) {
      logger.error("Failed to sync reconciliation cascade on status update:", syncError.message);
    }

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
      credit_type: data.credit_type !== undefined ? data.credit_type : existingDeal.credit_type,
      status: data.status,
      action_by: userId,
      action_at: new Date(),
      completed_at: data.status === "Completed" ? new Date() : undefined,
      updated_at: new Date(),
      pre_date: data.pre_date ? new Date(data.pre_date) : undefined,
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

    // Automatically Sync Reconciliations and Cascade
    try {
      const { syncReconciliationCascade } = require("./reconciliation.service");

      if (updatedDeal.pre_date) {
        const oldPreDate = existingDeal.pre_date ? new Date(existingDeal.pre_date) : null;
        const newPreDate = new Date(updatedDeal.pre_date);

        const dateChanged = !oldPreDate || oldPreDate.toISOString().split('T')[0] !== newPreDate.toISOString().split('T')[0];

        if (dateChanged) {
          // 1. Remove old mapping
          await getdb.reconciliationDeal.deleteMany({ where: { deal_id: updatedDeal.id } });

          // 2. Map to the new reconciliation if it exists for the new pre_date
          const startOfDay = new Date(newPreDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(newPreDate);
          endOfDay.setHours(23, 59, 59, 999);

          const newRecon = await getdb.reconciliation.findFirst({
            where: { created_at: { gte: startOfDay, lte: endOfDay } },
            orderBy: { created_at: "asc" }
          });

          if (newRecon) {
            await getdb.reconciliationDeal.create({
              data: {
                reconciliation_id: newRecon.id,
                deal_id: updatedDeal.id
              }
            });
            logger.info(`Re-mapped deal ${updatedDeal.deal_number} to reconciliation ${newRecon.id}`);
          }
        }

        // Trigger cascading sync from the EARLIEST of old or new pre_date to ensure integrity
        let syncStartDate = newPreDate;
        if (oldPreDate && oldPreDate < syncStartDate) {
          syncStartDate = oldPreDate;
        }

        await syncReconciliationCascade(syncStartDate, userId);
      }
    } catch (syncError) {
      logger.error("Failed to sync reconciliation cascade on update:", syncError.message);
    }

    return updatedDeal;
  } catch (error) {
    logger.error("Failed to update deal:", error.message);
    throw error;
  }
};


const requestEditDeal = async (dealId, userId, message) => {
  try {
    const deal = await getdb.deal.findUnique({ where: { id: Number(dealId) } });
    if (!deal) throw new Error("Deal not found");

    const admins = await getdb.user.findMany({ where: { role: "Admin", deleted_at: null } });

    const notifications = admins.map(admin => ({
      user_id: admin.id,
      title: "Deal Edit Request",
      message: `Maker requested edit for Deal #${deal.deal_number}. Message: ${message}`,
      alert_type: "DEAL_EDIT_REQUEST",
      reference_id: deal.id,
    }));

    await getdb.notification.createMany({ data: notifications });
    return { success: true };
  } catch (error) {
    logger.error("Failed to request deal edit:", error.message);
    throw error;
  }
};

const deleteDeal = async (id, userId) => {
  try {
    const existingDeal = await getdb.deal.findUnique({
      where: { id: Number(id) },
    });

    if (!existingDeal) {
      throw new Error("Deal not found");
    }

    // Capture associated reconciliation IDs before deleting mappings
    const mappedRecons = await getdb.reconciliationDeal.findMany({
      where: { deal_id: Number(id) }
    });

    // Remove deal from mappings
    await getdb.reconciliationDeal.deleteMany({
      where: { deal_id: Number(id) }
    });

    // Soft delete the deal
    const updated = await getdb.deal.update({
      where: { id: Number(id) },
      data: { deleted_at: new Date() },
    });

    // Recalculate status for all affected reconciliations and cascade
    try {
      const { syncReconciliationCascade } = require("./reconciliation.service");
      if (existingDeal.pre_date) {
        await syncReconciliationCascade(existingDeal.pre_date, userId);
      }
    } catch (syncError) {
      logger.error("Failed to update reconciliation cascade after deal delete:", syncError.message);
    }

    logger.info(`Deal soft deleted and removed from reconciliation: ${updated.id} ${updated.deal_number}`);
    return updated;
  } catch (error) {
    logger.error(`Failed to delete deal with ID ${id}:`, error.message);
    throw error;
  }
};

module.exports = {
  createDeal,
  getAllDeals,
  getDealById,
  updateDealStatus,
  updateDeal,
  requestEditDeal,
  deleteDeal
};

