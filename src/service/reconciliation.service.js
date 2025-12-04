const { getdb } = require("../config/db");
const logger = require("../config/logger");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const createReconciliation = async (data, userId) => {
    try {
        const totalOpening = data.openingEntries.reduce(
            (sum, entry) => sum + Number(entry.amount),
            0
        );
        const totalClosing = data.closingEntries.reduce(
            (sum, entry) => sum + Number(entry.amount),
            0
        );

        let status;
        if (totalClosing === totalOpening) status = "Tallied";
        else if (totalClosing < totalOpening) status = "Short";
        else status = "Excess";

        const newReconciliation = await getdb.reconciliation.create({
            data: {
                status,
                created_by: userId,
                created_at: new Date(),
                updated_at: new Date(),
                openingEntries: {
                    create: data.openingEntries.map((entry) => ({
                        denomination: entry.denomination,
                        quantity: entry.quantity,
                        amount: entry.amount,
                        currency_id: entry.currency_id,
                    })),
                },
                closingEntries: {
                    create: data.closingEntries.map((entry) => ({
                        denomination: entry.denomination,
                        quantity: entry.quantity,
                        amount: entry.amount,
                        currency_id: entry.currency_id,
                    })),
                },
                notes: data.notes
                    ? {
                        create: data.notes.map((note) => ({ note })),
                    }
                    : undefined,
            },
            include: {
                openingEntries: { include: { currency: { select: { id: true, code: true, name: true } } } },
                closingEntries: { include: { currency: { select: { id: true, code: true, name: true } } } },
                notes: true,
                createdBy: { select: { id: true, full_name: true, email: true } },
            },
        });

        return newReconciliation;
    } catch (error) {
        logger.error("Failed to create reconciliation:", error);
        throw error;
    }
};

const getAllReconciliations = async ({
    page = 1,
    limit = 10,
    dateFilter = "today",
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

        if (status) {
            where.status = status;
        } else {
            // Default: show only Short/Excess for past dates, show all for today
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            if (start.getTime() >= todayStart.getTime() && end.getTime() <= todayEnd.getTime()) {
            } else {
                where.status = { in: ["Short", "Excess"] };
            }
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
                createdBy: { select: { id: true, full_name: true, email: true } },
            },
            orderBy: { created_at: "desc" },
            skip,
            take: limit,
        });

        if (format === "excel") {
        const filePath = await generateExcel(reconciliations);
        return { filePath };
        }

        if (format === "pdf") {
        const filePath = await generatePDF(reconciliations);
        return { filePath };
        }

        return { data: reconciliations, total };
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

  const folder = path.join(__dirname, "../downloads");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);

  const filePath = path.join(folder, `reconciliations_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  return filePath;
};

const generatePDF = async (recs) => {
  const folder = path.join(__dirname, "../downloads");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);

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

const getReconciliationById = async (id) => {
    try {
        const rec = await getdb.reconciliation.findUnique({
            where: { id: Number(id) },
            include: {
                openingEntries: { include: { currency: { select: { id: true, code: true, name: true } } } },
                closingEntries: { include: { currency: { select: { id: true, code: true, name: true } } } },
                notes: true,
                createdBy: { select: { id: true, full_name: true, email: true } },
            },
        });
        if (!rec) throw new Error("Reconciliation not found");
        return rec;
    } catch (error) {
        logger.error("Failed to fetch reconciliation by ID:", error);
        throw error;
    }
};

const updateReconciliationStatus = async (id, status, notes, userId) => {
    try {
        return await getdb.reconciliation.update({
            where: { id: Number(id) },
            data: {
                status,
                updated_at: new Date(),
                notes: notes
                    ? {
                        create: notes.map((note) => ({ note })),
                    }
                    : undefined,
            },
            include: {
                notes: true,
                createdBy: { select: { id: true, full_name: true, email: true } },
                openingEntries: { include: { currency: { select: { id: true, code: true, name: true } } } },
                closingEntries: { include: { currency: { select: { id: true, code: true, name: true } } } },
            },
        });
    } catch (error) {
        logger.error("Failed to update reconciliation status:", error);
        throw error;
    }
};

module.exports = {
    createReconciliation,
    getAllReconciliations,
    getReconciliationById,
    updateReconciliationStatus,
};
