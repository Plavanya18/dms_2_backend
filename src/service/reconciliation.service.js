const { getdb } = require("../config/db");
const logger = require("../config/logger");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const os = require("os");

const createReconciliation = async (data, userId) => {
  try {
    if (!Array.isArray(data.openingEntries) || data.openingEntries.length === 0) {
      throw new Error("Opening entries are required to create a reconciliation.");
    }

    const now = new Date();
    const hasOpening = Array.isArray(data.openingEntries) && data.openingEntries.length > 0;
    const hasClosing = Array.isArray(data.closingEntries) && data.closingEntries.length > 0;

    const reconciliationStatus = hasClosing ? (data.status || "In_Progress") : "In_Progress";

    const newReconciliation = await getdb.reconciliation.create({
      data: {
        status: reconciliationStatus,
        created_by: userId,
        created_at: now,
        updated_at: now,
        openingEntries: {
          create: data.openingEntries.map((entry) => ({
            denomination: entry.denomination || entry.amount || 0,
            quantity: entry.quantity !== undefined && entry.quantity !== null ? entry.quantity : 1,
            amount: entry.amount,
            exchange_rate: entry.exchange_rate || 1.0,
            currency_id: entry.currency_id,
          })),
        },
        ...(hasClosing && {
          closingEntries: {
            create: data.closingEntries.map((entry) => ({
              denomination: entry.denomination || entry.amount || 0,
              quantity: entry.quantity !== undefined && entry.quantity !== null ? entry.quantity : 1,
              amount: entry.amount,
              exchange_rate: entry.exchange_rate || 1.0,
              currency_id: entry.currency_id,
            })),
          },
        }),
        ...(Array.isArray(data.notes) && data.notes.length > 0 && {
          notes: {
            create: data.notes.map((note) => {
              const noteText = typeof note === 'string' ? note : note.note || note.text;
              return { note: noteText };
            }),
          },
        }),
      },
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        notes: true,
      },
    });

    logger.info("Reconciliation created successfully.");
    return newReconciliation;

  } catch (error) {
    logger.error("Failed to create reconciliation:", error);
    throw error;
  }
};

const startReconciliation = async (id, userId) => {
  try {
    const reconciliation = await getdb.reconciliation.findUnique({
      where: { id: Number(id) },
    });

    if (!reconciliation) {
      throw new Error("Reconciliation not found");
    }

    // Get the start and end of the day the reconciliation was created
    const startOfDay = new Date(reconciliation.created_at);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reconciliation.created_at);
    endOfDay.setHours(23, 59, 59, 999);

    // Find all deals created on that day that are NOT already associated with a reconciliation
    const deals = await getdb.deal.findMany({
      where: {
        created_at: {
          gte: startOfDay,
          lte: endOfDay,
        },
        reconciliations: {
          none: {},
        },
      },
    });

    if (deals.length > 0) {
      await getdb.reconciliationDeal.createMany({
        data: deals.map((deal) => ({
          reconciliation_id: reconciliation.id,
          deal_id: deal.id,
        })),
      });
    }

    const updatedReconciliation = await getdb.reconciliation.findUnique({
      where: { id: reconciliation.id },
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        notes: true,
        deals: {
          include: {
            deal: {
              include: { receivedItems: true, paidItems: true }
            }
          }
        },
      },
    });

    const currencyTotals = {};

    updatedReconciliation.openingEntries.forEach(entry => {
      const cid = entry.currency_id;
      if (!currencyTotals[cid]) currencyTotals[cid] = { expected: 0, actual: 0 };
      currencyTotals[cid].expected += Number(entry.amount || 0);
    });

    updatedReconciliation.closingEntries.forEach(entry => {
      const cid = entry.currency_id;
      if (!currencyTotals[cid]) currencyTotals[cid] = { expected: 0, actual: 0 };
      currencyTotals[cid].actual += Number(entry.amount || 0);
    });

    updatedReconciliation.deals.forEach(rd => {
      const deal = rd.deal;
      const hasItems = (deal.receivedItems?.length > 0 || deal.paidItems?.length > 0);

      if (hasItems) {
        deal.receivedItems.forEach(item => {
          const cid = item.currency_id;
          if (!currencyTotals[cid]) currencyTotals[cid] = { expected: 0, actual: 0 };
          currencyTotals[cid].expected += Number(item.total || 0);
        });
        deal.paidItems.forEach(item => {
          const cid = item.currency_id;
          if (!currencyTotals[cid]) currencyTotals[cid] = { expected: 0, actual: 0 };
          currencyTotals[cid].expected -= Number(item.total || 0);
        });
      } else {
        const buyCid = deal.buy_currency_id;
        const sellCid = deal.sell_currency_id;
        const amount = Number(deal.amount || 0);
        const amountToBePaid = Number(deal.amount_to_be_paid || 0);

        if (deal.deal_type === "buy") {
          if (buyCid) {
            if (!currencyTotals[buyCid]) currencyTotals[buyCid] = { expected: 0, actual: 0 };
            currencyTotals[buyCid].expected += amount;
          }
          if (sellCid) {
            if (!currencyTotals[sellCid]) currencyTotals[sellCid] = { expected: 0, actual: 0 };
            currencyTotals[sellCid].expected -= amountToBePaid;
          }
        } else if (deal.deal_type === "sell") {
          if (buyCid) {
            if (!currencyTotals[buyCid]) currencyTotals[buyCid] = { expected: 0, actual: 0 };
            currencyTotals[buyCid].expected += amountToBePaid;
          }
          if (sellCid) {
            if (!currencyTotals[sellCid]) currencyTotals[sellCid] = { expected: 0, actual: 0 };
            currencyTotals[sellCid].expected -= amount;
          }
        }
      }
    });

    let finalStatus = "Tallied";
    let hasExcess = false;
    let hasShort = false;

    Object.values(currencyTotals).forEach(v => {
      const diff = v.actual - v.expected;
      if (Math.abs(diff) < 0.01) return;
      if (diff > 0) hasExcess = true;
      if (diff < 0) hasShort = true;
    });

    if (hasShort) finalStatus = "Short";
    else if (hasExcess) finalStatus = "Excess";

    await getdb.reconciliation.update({
      where: { id: reconciliation.id },
      data: { status: finalStatus, updated_at: new Date() }
    });

    logger.info(`Reconciliation ${id} started. Final status: ${finalStatus}. ${deals.length} deals associated.`);

    return await getdb.reconciliation.findUnique({
      where: { id: reconciliation.id },
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        notes: true,
        deals: { include: { deal: true } },
      },
    });
  } catch (error) {
    logger.error("Failed to start reconciliation:", error);
    throw error;
  }
};

const getAllReconciliations = async ({
  page = 1,
  limit = 10,
  dateFilter,
  startDate,
  endDate,
  status,
  format,
}) => {
  try {
    const skip = (page - 1) * limit;
    const where = {};

    const now = new Date();
    let start, end;

    if (dateFilter) {
      switch (dateFilter) {
        case "today":
          start = new Date(now.setHours(0, 0, 0, 0));
          end = new Date(now.setHours(23, 59, 59, 999));
          break;

        case "yesterday":
          const yesterday = new Date();
          yesterday.setDate(now.getDate() - 1);
          start = new Date(yesterday.setHours(0, 0, 0, 0));
          end = new Date(yesterday.setHours(23, 59, 59, 999));
          break;

        case "last7":
          start = new Date(now);
          start.setDate(now.getDate() - 7);
          start.setHours(0, 0, 0, 0);
          end = new Date(now.setHours(23, 59, 59, 999));
          break;

        case "thisMonth":
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          start.setHours(0, 0, 0, 0);
          end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          end.setHours(23, 59, 59, 999);
          break;

        case "custom":
          if (startDate && endDate) {
            start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
          } else {
            throw new Error("For custom dateFilter, startDate and endDate are required");
          }
          break;

        default:
          throw new Error("Invalid dateFilter value");
      }
    }

    if (status) {
      where.status = status;
    }

    where.created_at = { gte: start, lte: end };

    const total = await getdb.reconciliation.count({ where });

    const reconciliations = await getdb.reconciliation.findMany({
      where,
      include: {
        openingEntries: {
          include: { currency: { select: { id: true, code: true, name: true } } },
        },
        closingEntries: {
          include: { currency: { select: { id: true, code: true, name: true } } },
        },
        notes: true,
        deals: {
          include: {
            deal: {
              include: {
                customer: { select: { name: true } },
                buyCurrency: { select: { code: true } },
                sellCurrency: { select: { code: true } }
              }
            }
          }
        },
        createdBy: { select: { id: true, full_name: true, email: true } },
      },
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    });

    const enhancedData = reconciliations.map((rec) => {
      const opening_total = rec.openingEntries.reduce(
        (sum, entry) => sum + Number(entry.amount || 0),
        0
      );

      const closing_total = rec.closingEntries.reduce(
        (sum, entry) => sum + Number(entry.amount || 0),
        0
      );

      const total_transactions = rec.deals.length;

      const difference = opening_total - closing_total;

      return {
        ...rec,
        opening_total,
        closing_total,
        total_transactions,
        difference,
      };
    });

    if (format === "excel") {
      const filePath = await generateExcel(reconciliations);
      return { filePath };
    }

    if (format === "pdf") {
      const filePath = await generatePDF(reconciliations);
      return { filePath };
    }

    return { data: enhancedData, total };
  } catch (error) {
    logger.error("Failed to fetch reconciliations:", error);
    throw error;
  }
};

const generateExcel = async (recs) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reconciliations");

  sheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Status", key: "status", width: 15 },
    { header: "Created At", key: "created_at", width: 20 },
    { header: "Created By", key: "created_by", width: 20 },
    { header: "Opening Entries", key: "opening_entries", width: 50 },
    { header: "Closing Entries", key: "closing_entries", width: 50 },
    { header: "Notes", key: "notes", width: 50 },
  ];

  recs.forEach((r) => {
    const openingStr = r.openingEntries
      .map(
        (o) =>
          `${o.denomination}x${o.quantity} = ${o.amount} ${o.currency.code}`
      )
      .join("; ");

    const closingStr = r.closingEntries
      .map(
        (c) =>
          `${c.denomination}x${c.quantity} = ${c.amount} ${c.currency.code}`
      )
      .join("; ");

    const notesStr = r.notes.map((n) => n.note).join("; ");

    sheet.addRow({
      id: r.id,
      status: r.status,
      created_at: r.created_at.toISOString(),
      created_by: r.createdBy?.full_name,
      opening_entries: openingStr,
      closing_entries: closingStr,
      notes: notesStr,
    });
  });

  const folder = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(folder)) {
    // Fallback if Desktop doesn't exist for some reason
    const backupFolder = path.join(__dirname, "../downloads");
    if (!fs.existsSync(backupFolder)) fs.mkdirSync(backupFolder);
    const filePath = path.join(backupFolder, `reconciliations_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  const filePath = path.join(folder, `reconciliations_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  return filePath;
};

const generatePDF = async (recs) => {
  let folder = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(folder)) {
    folder = path.join(__dirname, "../downloads");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  }
  const filePath = path.join(folder, `reconciliations_${Date.now()}.pdf`);
  const doc = new PDFDocument({ margin: 30, size: "A4" });
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(18).text("Reconciliation Report", { underline: true });
  doc.moveDown(1);

  recs.forEach((r) => {
    const openingStr = r.openingEntries
      .map(
        (o) =>
          `${o.denomination}x${o.quantity} = ${o.amount} ${o.currency.code}`
      )
      .join("; ");

    const closingStr = r.closingEntries
      .map(
        (c) =>
          `${c.denomination}x${c.quantity} = ${c.amount} ${c.currency.code}`
      )
      .join("; ");

    const notesStr = r.notes.map((n) => n.note).join("; ");

    doc.fontSize(12).text(`
ID: ${r.id}
Status: ${r.status}
Created At: ${r.created_at.toISOString()}
Created By: ${r.createdBy?.full_name}
Opening Entries: ${openingStr}
Closing Entries: ${closingStr}
Notes: ${notesStr}
-----------------------------------------
`);
  });

  doc.end();

  return new Promise((resolve) => {
    writeStream.on("finish", () => resolve(filePath));
  });
};

const timeAgo = (date) => {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000);

  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes > 1 ? "s" : ""} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(date).toLocaleDateString("en-GB");
};

const getReconciliationAlerts = async () => {
  const result = await getdb.reconciliation.findMany({
    where: {
      status: {
        in: ["Short", "Excess"],
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  const reconciliationFormatted = result.map((item) => {
    const { updated_at, id, ...rest } = item;

    return {
      id,
      ...rest,
      alertType: "RECONCILIATION",
      title: "Reconciliation Required",
      message: `Reconciliation ID ${id} need reconciliation review.`,
      created_at: timeAgo(item.created_at),
    };
  });

  const pendingDeals = await getdb.deal.findMany({
    where: {
      status: "Pending",
      deleted_at: null,
    },
    orderBy: {
      created_at: "desc",
    },
    select: {
      id: true,
      deal_number: true,
      status: true,
      created_at: true,
    },
  });

  const pendingFormatted = pendingDeals.map((deal) => ({
    id: deal.id,
    deal_number: deal.deal_number,
    status: deal.status,
    created_at: timeAgo(deal.created_at),
    alertType: "PENDING_DEAL",
    title: "Pending Deal",
    message: `Deal ID ${deal.id} is still pending.`,
  }));

  return [...reconciliationFormatted, ...pendingFormatted];
};

const getReconciliationById = async (id) => {
  try {
    const rec = await getdb.reconciliation.findUnique({
      where: { id: Number(id) },
      include: {
        openingEntries: { include: { currency: { select: { id: true, code: true, name: true } } } },
        closingEntries: { include: { currency: { select: { id: true, code: true, name: true } } } },
        notes: true,
        deals: {
          include: {
            deal: {
              include: {
                customer: { select: { name: true } },
                buyCurrency: { select: { code: true } },
                sellCurrency: { select: { code: true } }
              }
            }
          }
        },
        createdBy: { select: { id: true, full_name: true, email: true } },
      },
    });
    if (!rec) throw new Error("Reconciliation not found");

    let totalBuy = 0;
    let totalSell = 0;

    // Focus totals on TZS (the base currency) for meaningful summary volume
    for (const dealRec of rec.deals) {
      const deal = dealRec.deal;
      if (deal.deal_type === 'buy') {
        // Shop sells TZS (amount_to_be_paid)
        totalSell += Number(deal.amount_to_be_paid || 0);
      } else {
        // Shop buys TZS (amount_to_be_paid)
        totalBuy += Number(deal.amount_to_be_paid || 0);
      }
    }

    return {
      ...rec,
      totalBuy,
      totalSell,
    };
  } catch (error) {
    logger.error("Failed to fetch reconciliation by ID:", error);
    throw error;
  }
};

const updateReconciliation = async (id, data, userId) => {
  try {
    const reconciliation = await getdb.reconciliation.findUnique({
      where: { id: Number(id) },
      include: {
        openingEntries: true,
        closingEntries: true,
      },
    });

    if (!reconciliation) return null;

    const hasOpening = Array.isArray(data.openingEntries);
    const hasClosing = Array.isArray(data.closingEntries);

    if (hasOpening) await getdb.reconciliationOpening.deleteMany({ where: { reconciliation_id: reconciliation.id } });
    if (hasClosing) await getdb.reconciliationClosing.deleteMany({ where: { reconciliation_id: reconciliation.id } });
    if (Array.isArray(data.notes)) await getdb.reconciliationNote.deleteMany({ where: { reconciliation_id: reconciliation.id } });

    const now = new Date();

    const updatedReconciliation = await getdb.reconciliation.update({
      where: { id: reconciliation.id },
      data: {
        status: data.status,
        updated_at: now,
        ...(hasOpening && {
          openingEntries: {
            create: data.openingEntries.map(e => ({
              denomination: e.denomination || e.amount || 0,
              quantity: e.quantity !== undefined && e.quantity !== null ? e.quantity : 1,
              amount: e.amount,
              exchange_rate: e.exchange_rate || 1.0,
              currency_id: e.currency_id,
            }))
          },
        }),
        ...(hasClosing && {
          closingEntries: {
            create: data.closingEntries.map(e => ({
              denomination: e.denomination || e.amount || 0,
              quantity: e.quantity !== undefined && e.quantity !== null ? e.quantity : 1,
              amount: e.amount,
              exchange_rate: e.exchange_rate || 1.0,
              currency_id: e.currency_id,
            }))
          },
        }),
        ...(Array.isArray(data.notes) && data.notes.length > 0 && {
          notes: { create: data.notes.map(n => ({ note: n })) },
        }),
      },
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        notes: true,
      },
    });

    return updatedReconciliation;
  } catch (error) {
    console.error("Failed to update reconciliation:", error);
    throw error;
  }
};

module.exports = {
  createReconciliation,
  getAllReconciliations,
  getReconciliationAlerts,
  getReconciliationById,
  updateReconciliation,
  startReconciliation,
};
