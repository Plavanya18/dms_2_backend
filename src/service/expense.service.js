const { getdb } = require("../config/db");
const logger = require("../config/logger");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const os = require("os");
const { mapDailyExpenses, calculateAndSetReconciliationStatus } = require("./reconciliation.service");

const formatDateDDMMYYYY = (date) => {
    if (!date) return "";
    const d = new Date(date);
    return `${d.getUTCDate().toString().padStart(2, "0")}/${(d.getUTCMonth() + 1).toString().padStart(2, "0")}/${d.getUTCFullYear()}`;
};

const capitalizeWords = (str) => {
  if (!str) return "";
  return str.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
};

/**
 * Create a new expense
 */
const createExpense = async (data, userId) => {
    try {
        const numericUserId = Number(userId);
        if (isNaN(numericUserId)) {
            logger.error(`Invalid userId provided to createExpense: ${userId}`);
            throw new Error("Invalid User ID");
        }

        logger.info(`Creating expense for user: ${numericUserId}`);
        const expense = await getdb.expense.create({
            data: {
                category: data.category,
                description: data.description,
                amount: data.amount,
                rate: data.rate,
                currency: {
                    connect: { id: data.currency_id ? Number(data.currency_id) : 1 }
                },
                date: data.date ? new Date(data.date) : new Date(),
                createdBy: {
                    connect: { id: numericUserId }
                }
            },
        });

        // Trigger mapping if a reconciliation exists for this date
        const recon = await getdb.reconciliation.findFirst({
            where: {
                created_at: {
                    gte: new Date(new Date(expense.date).setUTCHours(0, 0, 0, 0)),
                    lte: new Date(new Date(expense.date).setUTCHours(23, 59, 59, 999)),
                }
            }
        });

        if (recon) {
            logger.info(`Found reconciliation ${recon.id} for auto-mapping.`);
            await mapDailyExpenses(recon.id, userId);
            await calculateAndSetReconciliationStatus(recon.id, userId);
        }

        return expense;
    } catch (error) {
        logger.error("Error creating expense:", error);
        throw error;
    }
};

/**
 * Get all expenses with filters
 */
const getAllExpenses = async (params = {}) => {
    try {
        const { page = 1, limit = 10, category, currency_id, startDate, endDate, dateFilter, format, userId } = params;
        const skip = (page - 1) * limit;
        const now = new Date();

        const where = {};
        if (category) where.category = category;
        if (currency_id) where.currency_id = Number(currency_id);

        if (dateFilter) {
            if (dateFilter === "today") {
                const startToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
                const endToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
                where.date = { gte: startToday, lte: endToday };
            } else if (dateFilter === "last7") {
                where.date = { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7, 0, 0, 0, 0)) };
            } else if (dateFilter === "last30") {
                where.date = { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30, 0, 0, 0, 0)) };
            } else if (dateFilter === "last90") {
                where.date = { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 90, 0, 0, 0, 0)) };
            } else if (dateFilter === "custom" && (startDate || endDate)) {
                where.date = {};
                if (startDate) {
                    const s = new Date(startDate);
                    where.date.gte = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 0, 0, 0, 0));
                }
                if (endDate) {
                    const e = new Date(endDate);
                    where.date.lte = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate(), 23, 59, 59, 999));
                }
            }
        } else if (startDate || endDate) {
            where.date = {};
            if (startDate) where.date.gte = new Date(startDate);
            if (endDate) where.date.lte = new Date(endDate);
        }

        const expenses = await getdb.expense.findMany({
            where,
            skip: (format === "pdf" || format === "excel") ? undefined : skip,
            take: (format === "pdf" || format === "excel") ? undefined : Number(limit),
            orderBy: { date: "desc" },
            include: {
                createdBy: { select: { id: true, full_name: true } },
                currency: { select: { id: true, code: true, symbol: true } }
            },
        });

        if (format === "pdf") {
            let downloader = null;
            if (userId) {
                downloader = await getdb.user.findUnique({
                    where: { id: Number(userId) },
                    select: { full_name: true, phone_number: true, email: true }
                });
            }

            const sStr = startDate || (start ? start.toISOString().split("T")[0] : null);
            const eStr = endDate || (end ? end.toISOString().split("T")[0] : null);
            const filePath = await generateExpensesPDF(expenses, { startDate: sStr, endDate: eStr, user: downloader });
            return { filePath };
        }

        if (format === "excel") {
            const filePath = await generateExpensesExcel(expenses);
            return { filePath };
        }

        const total = await getdb.expense.count({ where });

        return {
            data: expenses,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / limit),
            },
        };
    } catch (error) {
        logger.error("Error fetching expenses:", error);
        throw error;
    }
};

/**
 * Update an expense
 */
const updateExpense = async (id, data, userId) => {
    try {
        const updateData = {
            category: data.category,
            description: data.description,
            amount: data.amount,
            rate: data.rate,
            date: data.date ? new Date(data.date) : undefined,
        };

        if (data.currency_id) {
            updateData.currency = {
                connect: { id: Number(data.currency_id) }
            };
        }

        // Remove undefined fields
        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

        const updatedExpense = await getdb.expense.update({
            where: { id: Number(id) },
            data: updateData,
        });

        // Trigger re-mapping
        const recon = await getdb.reconciliation.findFirst({
            where: {
                created_at: {
                    gte: new Date(new Date(updatedExpense.date).setUTCHours(0, 0, 0, 0)),
                    lte: new Date(new Date(updatedExpense.date).setUTCHours(23, 59, 59, 999)),
                }
            }
        });

        if (recon) {
            await mapDailyExpenses(recon.id, userId);
            await calculateAndSetReconciliationStatus(recon.id, userId);
        }

        return updatedExpense;
    } catch (error) {
        logger.error("Error updating expense:", error);
        throw error;
    }
};

/**
 * Delete an expense
 */
const deleteExpense = async (id, userId) => {
    try {
        // Find reconciliation before deleting to trigger status update after
        const expense = await getdb.expense.findUnique({ where: { id: Number(id) } });

        const result = await getdb.expense.delete({
            where: { id: Number(id) },
        });

        if (expense) {
            const recon = await getdb.reconciliation.findFirst({
                where: {
                    created_at: {
                        gte: new Date(new Date(expense.date).setUTCHours(0, 0, 0, 0)),
                        lte: new Date(new Date(expense.date).setUTCHours(23, 59, 59, 999)),
                    }
                }
            });

            if (recon) {
                // Since it's a hard delete, junction table records are already cascaded
                await calculateAndSetReconciliationStatus(recon.id, userId);
            }
        }

        return result;
    } catch (error) {
        logger.error("Error deleting expense:", error);
        throw error;
    }
};

const generateExpensesExcel = async (expenses) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Expenses");

    sheet.columns = [
        { header: "ID", key: "id", width: 10 },
        { header: "Date", key: "date", width: 20 },
        { header: "Category", key: "category", width: 20 },
        { header: "Description", key: "description", width: 40 },
        { header: "Amount", key: "amount", width: 15 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Rate", key: "rate", width: 10 },
    ];

    expenses.forEach((exp) => {
        sheet.addRow({
            id: exp.id,
            date: new Date(exp.date).toLocaleDateString(),
            category: exp.category,
            description: exp.description,
            amount: exp.amount,
            currency: exp.currency?.code,
            rate: exp.rate,
        });
    });

    let folder = path.join(os.homedir(), "Desktop");
    if (!fs.existsSync(folder)) {
        folder = path.join(__dirname, "../downloads");
        if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    }
    const filePath = path.join(folder, `expenses_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
};

const generateExpensesPDF = async (expenses, options = {}) => {
    let folder = path.join(os.homedir(), "Desktop");
    if (!fs.existsSync(folder)) {
        folder = path.join(__dirname, "../downloads");
        if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    }
    const filePath = path.join(folder, `expenses_report_${Date.now()}.pdf`);
    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "portrait", bufferPages: true });

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // 🎨 COLORS & CONSTANTS (Professional Blue Theme)
    const PRIMARY_COLOR = "#1D4CB5";
    const TEXT_COLOR = "#333333";
    const SECONDARY_TEXT = "#666666";
    const BORDER_COLOR = "#EEEEEE";
    const WHITE = "#FFFFFF";

    const { startDate, endDate, user } = options;
    const dateRangeStr = (startDate && endDate)
        ? (startDate === endDate ? `For ${formatDateDDMMYYYY(startDate)}` : `From ${formatDateDDMMYYYY(startDate)} To ${formatDateDDMMYYYY(endDate)}`)
        : `Generated on ${new Date().toLocaleDateString()}`;

    // --- 🏷️ HEADER SECTION ---
    const drawHeader = () => {
        doc.rect(0, 0, doc.page.width, 8).fill(PRIMARY_COLOR);

        const drawUsoftLogo = (docInst, x, y, size = 42) => {
            const scale = size / 16;
            docInst.save();
            docInst.translate(x, y);
            docInst.scale(scale);
            const grad = docInst.linearGradient(8, 0, 8, 16);
            grad.stop(0, "#07122A"); grad.stop(1, "#123FA2");
            docInst.roundedRect(0, 0, 16, 16, 2).fill(grad);
            docInst.path("M5.67578 3.33203V8.6377C5.6759 9.11929 5.78028 9.54823 5.99023 9.92285C6.20439 10.2974 6.50561 10.5916 6.89258 10.8057C7.27973 11.0198 7.73129 11.127 8.24609 11.127C8.76481 11.1269 9.21572 11.0197 9.59863 10.8057C9.98565 10.5916 10.2851 10.2975 10.4951 9.92285C10.7092 9.54823 10.8163 9.11929 10.8164 8.6377V5.88965L13.4912 7.2207V8.86621C13.4911 9.78858 13.2707 10.5963 12.8301 11.2881C12.3935 11.9798 11.7816 12.5191 10.9951 12.9062C10.2085 13.2892 9.29206 13.4814 8.24609 13.4814C7.19582 13.4814 6.27693 13.2893 5.49023 12.9062C4.70371 12.5192 4.09187 11.9798 3.65527 11.2881C3.21877 10.5963 3.00012 9.78858 3 8.86621V2L5.67578 3.33203Z").fill("white");
            docInst.rect(8.53259, 3.57251, 2.32942, 2.32942).fill("#5761D7");
            docInst.rect(10.8619, 2.29102, 1.28118, 1.28118).fill("#DA0404");
            docInst.restore();
        };

        drawUsoftLogo(doc, 30, 30);
        doc.fillColor(TEXT_COLOR).fontSize(18).font("Helvetica-Bold").text("Usoft", 80, 40);

        const downloaderName = (user?.full_name || "");
        const downloaderPhone = user?.phone_number || "";
        const downloaderEmail = user?.email || "";

        const rightAlignX = doc.page.width - 230;
        doc.fillColor(SECONDARY_TEXT).fontSize(8).font("Helvetica");
        if (downloaderName) doc.text(`Generated by: ${downloaderName}`, rightAlignX, 35, { align: "right", width: 200 });
        if (downloaderPhone) doc.text(`Phone: ${downloaderPhone}`, rightAlignX, 48, { align: "right", width: 200 });
        if (downloaderEmail) doc.text(`Email: ${downloaderEmail}`, rightAlignX, 61, { align: "right", width: 200 });
    };

    drawHeader();

    // --- 🏢 TITLE SECTION ---
    doc.fillColor(TEXT_COLOR).fontSize(14).font("Helvetica-Bold").text("Expenses Report", 30, 100);
    doc.fontSize(8).font("Helvetica").fillColor(SECONDARY_TEXT).text(dateRangeStr, 30, 120);

    // --- 🛒 COMPACT TABLE (COLUMNS) ---
    const COLUMN_WIDTHS = {
        date: 65,
        category: 90,
        description: 240,
        amount: 80,
        rate: 60
    };

    const drawTableHeader = (y) => {
        doc.rect(30, y, 535, 25).fill(PRIMARY_COLOR);
        doc.fillColor(WHITE).fontSize(7).font("Helvetica-Bold");
        let currentX = 35;
        doc.text("Date", currentX, y + 9); currentX += COLUMN_WIDTHS.date;
        doc.text("Category", currentX, y + 9); currentX += COLUMN_WIDTHS.category;
        doc.text("Description", currentX, y + 9); currentX += COLUMN_WIDTHS.description;
        doc.text("Amount", currentX, y + 9); currentX += COLUMN_WIDTHS.amount;
        doc.text("Rate", currentX, y + 9);
    };

    let currentY = 145;
    drawTableHeader(currentY);
    currentY += 30;

    expenses.forEach((exp, index) => {
        if (currentY + 20 > 740) {
            doc.addPage();
            currentY = 40;
            drawTableHeader(currentY);
            currentY += 30;
        }

        doc.fillColor(TEXT_COLOR).fontSize(7).font("Helvetica");
        if (index % 2 === 1) {
            doc.rect(30, currentY - 4, 535, 18).fill("#F7F9FF");
            doc.fillColor(TEXT_COLOR);
        }

        let currentX = 35;
        doc.text(formatDateDDMMYYYY(exp.date), currentX, currentY); currentX += COLUMN_WIDTHS.date;
        doc.text(exp.category || "—", currentX, currentY); currentX += COLUMN_WIDTHS.category;
        doc.text(exp.description || "—", currentX, currentY, { width: COLUMN_WIDTHS.description - 10, ellipsis: true }); currentX += COLUMN_WIDTHS.description;
        doc.text(`${Number(exp.amount || 0).toLocaleString()} ${exp.currency?.code || ""}`, currentX, currentY); currentX += COLUMN_WIDTHS.amount;
        doc.text(Number(exp.rate || 0).toLocaleString(), currentX, currentY);

        currentY += 18;
    });

    const drawFooter = (docInst, pageNum, totalPages) => {
        const footerY = docInst.page.height - 110;
        docInst.fontSize(7).text(`Page ${pageNum} of ${totalPages}`, 30, footerY + 60, { align: "right", width: docInst.page.width - 60 });
    };

    let pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        drawFooter(doc, i + 1, pages.count);
    }

    doc.end();

    return new Promise((resolve) => {
        writeStream.on("finish", () => resolve(filePath));
    });
};

module.exports = {
    createExpense,
    getAllExpenses,
    updateExpense,
    deleteExpense,
};
