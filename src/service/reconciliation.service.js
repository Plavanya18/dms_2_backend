const { getdb } = require("../config/db");
const logger = require("../config/logger");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const os = require("os");
const openSetRateService = require("./openSetRate.service");

// ✅ Standardized date formatter to prevent timezone shifts (YYYY-MM-DD)
const formatDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateDDMMYYYY = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

const getCurrentDayReconciliation = async (userId) => {
  try {
    const now = new Date();
    // Normalize to Midnight UTC for stable comparison
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    // Check if today's shared reconciliation already exists (any user's recon for today)
    const existing = await getdb.reconciliation.findFirst({
      where: {
        created_at: { gte: startOfToday, lte: endOfToday },
      },
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        notes: true,
        deals: { include: { deal: true } },
      },
    });

    if (existing) return existing;

    // No today's reconciliation — look for the most recent previous shared one with closing entries
    let previous = await getdb.reconciliation.findFirst({
      where: {
        created_at: { lt: startOfToday },
        closingEntries: { some: {} },
      },
      orderBy: { created_at: "desc" },
      include: {
        closingEntries: { include: { currency: true } },
      },
    });

    if (!previous || previous.closingEntries.length === 0) {
      // First time ever — return null so the gate shows for manual entry
      return null;
    }

    // ✅ Detect Gaps and Fill them (Timezone Safe)
    const lastReconDate = new Date(previous.created_at);
    let gapDate = new Date(Date.UTC(lastReconDate.getUTCFullYear(), lastReconDate.getUTCMonth(), lastReconDate.getUTCDate()));
    gapDate.setUTCDate(gapDate.getUTCDate() + 1);

    while (gapDate < startOfToday) {
      logger.info(`Filling reconciliation gap for date: ${formatDate(gapDate)} using closing from ${formatDate(previous.created_at)}`);

      // Auto-create a "Tallied" reconciliation for the skipped day
      const gapRecon = await getdb.reconciliation.create({
        data: {
          created_by: userId,
          status: "Tallied",
          created_at: new Date(gapDate), // Midnight UTC of the gap day
          updated_at: new Date(),
          openingEntries: {
            create: previous.closingEntries.map((e) => ({
              denomination: e.denomination || e.amount || 0,
              quantity: e.quantity !== undefined && e.quantity !== null ? e.quantity : 1,
              amount: e.amount,
              exchange_rate: e.exchange_rate || 1.0,
              currency_id: e.currency_id,
            })),
          },
          closingEntries: {
            create: previous.closingEntries.map((e) => ({
              denomination: e.denomination || e.amount || 0,
              quantity: e.quantity !== undefined && e.quantity !== null ? e.quantity : 1,
              amount: e.amount,
              exchange_rate: e.exchange_rate || 1.0,
              currency_id: e.currency_id,
            })),
          }
        },
        include: {
          closingEntries: { include: { currency: true } },
        }
      });

      // Sync any deals that might fall into this gap (back-dated deals)
      await mapDailyDeals(gapRecon.id, userId);
      // Recalculate status (marks Tallied, propagates rates to next day)
      await calculateAndSetReconciliationStatus(gapRecon.id, userId);

      // Re-fetch to get accurate state for the next iteration step
      previous = await getdb.reconciliation.findUnique({
        where: { id: gapRecon.id },
        include: { closingEntries: { include: { currency: true } } }
      });

      gapDate.setUTCDate(gapDate.getUTCDate() + 1);
    }

    // Finally, Auto-create today's reconciliation using the last (gap or previous) closing as opening
    logger.info(`Auto-creating today's reconciliation for user ${userId} from most recent closing`);

    const newRecon = await getdb.reconciliation.create({
      data: {
        created_by: userId,
        status: "In_Progress",
        created_at: new Date(),
        updated_at: new Date(),
        openingEntries: {
          create: previous.closingEntries.map((e) => ({
            denomination: e.denomination || e.amount || 0,
            quantity: e.quantity !== undefined && e.quantity !== null ? e.quantity : 1,
            amount: e.amount,
            exchange_rate: e.exchange_rate || 1.0,
            currency_id: e.currency_id,
          })),
        },
      },
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        notes: true,
        deals: { include: { deal: true } },
      },
    });

    // Immediately sync today's deals into the new reconciliation
    await mapDailyDeals(newRecon.id, userId);
    await calculateAndSetReconciliationStatus(newRecon.id, userId);

    return await getdb.reconciliation.findUnique({
      where: { id: newRecon.id },
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        notes: true,
        deals: { include: { deal: true } },
      },
    });
  } catch (error) {
    logger.error("Failed to fetch/create current day reconciliation:", error);
    throw error;
  }
};

const mapDailyDeals = async (reconciliationId, userId) => {
  try {
    const reconciliation = await getdb.reconciliation.findUnique({
      where: { id: Number(reconciliationId) },
    });

    if (!reconciliation) throw new Error("Reconciliation not found");

    const startOfDay = new Date(reconciliation.created_at);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reconciliation.created_at);
    endOfDay.setHours(23, 59, 59, 999);

    const deals = await getdb.deal.findMany({
      where: {
        OR: [
          { pre_date: { gte: startOfDay, lte: endOfDay } },
          { pre_date: null, created_at: { gte: startOfDay, lte: endOfDay } }
        ],
        reconciliations: { none: {} },
        deleted_at: null,
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

    return deals.length;
  } catch (error) {
    logger.error("Failed to map daily deals:", error);
    throw error;
  }
};

const createReconciliation = async (data, userId) => {
  try {
    // Check if a shared reconciliation already exists for today (global, not user-specific)
    const existing = await getCurrentDayReconciliation(null);

    const hasOpening = Array.isArray(data.openingEntries) && data.openingEntries.length > 0;
    const hasClosing = Array.isArray(data.closingEntries) && data.closingEntries.length > 0;

    if (!hasOpening && !hasClosing && !data.notes) {
      throw new Error("No data provided to capture.");
    }

    const now = new Date();

    if (existing) {
      // If it exists, we behave like an update for the new entries provided
      // This supports the "use Create API for first time capture" even if recon exists
      return await updateReconciliation(existing.id, data, userId);
    }

    const reconciliationStatus = hasClosing ? (data.status || "In_Progress") : "In_Progress";

    const newReconciliation = await getdb.reconciliation.create({
      data: {
        status: reconciliationStatus,
        created_by: userId,
        created_at: now,
        updated_at: now,
        ...(hasOpening && {
          openingEntries: {
            create: data.openingEntries.map((entry) => ({
              denomination: Math.round(Number(entry.denomination || entry.amount || 0)),
              quantity: entry.quantity !== undefined && entry.quantity !== null ? entry.quantity : 1,
              amount: Math.round(Number(entry.amount)),
              exchange_rate: entry.exchange_rate || 1.0,
              currency_id: entry.currency_id,
            })),
          },
        }),
        ...(hasClosing && {
          closingEntries: {
            create: data.closingEntries.map((entry) => ({
              denomination: Math.round(Number(entry.denomination || entry.amount || 0)),
              quantity: entry.quantity !== undefined && entry.quantity !== null ? entry.quantity : 1,
              amount: Math.round(Number(entry.amount)),
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
        deals: { include: { deal: true } },
      },
    });

    logger.info("Reconciliation created successfully.");

    // Automatically map any existing deals for this date
    await mapDailyDeals(newReconciliation.id, userId);

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

    // Find all deals that were created today OR had payment activity today,
    // and are NOT already associated with THIS reconciliation (shared across all users)
    const deals = await getdb.deal.findMany({
      where: {
        OR: [
          {
            created_at: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
          {
            receivedItems: {
              some: {
                created_at: {
                  gte: startOfDay,
                  lte: endOfDay,
                },
              },
            },
          },
          {
            paidItems: {
              some: {
                created_at: {
                  gte: startOfDay,
                  lte: endOfDay,
                },
              },
            },
          },
        ],
        reconciliations: {
          none: {
            reconciliation_id: reconciliation.id
          },
        },
        deleted_at: null,
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

    return await calculateAndSetReconciliationStatus(reconciliation.id, userId);
  } catch (error) {
    logger.error("Failed to start reconciliation:", error);
    throw error;
  }
};

const calculateAndSetReconciliationStatus = async (id, userId) => {
  try {
    const updatedReconciliation = await getdb.reconciliation.findUnique({
      where: { id: Number(id) },
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

    if (!updatedReconciliation) {
      throw new Error("Reconciliation not found");
    }

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

    const reconDate = formatDate(updatedReconciliation.created_at);

    updatedReconciliation.deals.forEach(rd => {
      const deal = rd.deal;
      const dealDate = formatDate(deal.pre_date || deal.created_at);
      const isSameDayDeal = dealDate === reconDate;

      const matchingReceivedItems = (deal.receivedItems || []).filter(item => {
        if (!item.created_at) return true;
        return formatDate(item.created_at) === reconDate;
      });
      const matchingPaidItems = (deal.paidItems || []).filter(item => {
        if (!item.created_at) return true;
        return formatDate(item.created_at) === reconDate;
      });

      const hasMatchingItems = matchingReceivedItems.length > 0 || matchingPaidItems.length > 0;

      if (deal.status === "Pending") {
        const isPNBL = deal.credit_type === 'PNBL';
        const isBNPL = deal.credit_type === 'BNPL';

        const amount = Number(deal.amount || 0);
        const amountToBePaid = Number(deal.amount_to_be_paid || 0);
        const buyCid = deal.buy_currency_id;
        const sellCid = deal.sell_currency_id;

        const fullReceived = (deal.deal_type === "sell" ? amountToBePaid : amount) * (isSameDayDeal ? 1 : 0);
        const fullPaid = (deal.deal_type === "sell" ? amount : amountToBePaid) * (isSameDayDeal ? 1 : 0);

        const actualReceived = matchingReceivedItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
        const actualPaid = matchingPaidItems.reduce((sum, item) => sum + Number(item.total || 0), 0);

        let vaultAdd = 0;
        let vaultReduce = 0;

        if (isPNBL) {
          vaultAdd = actualReceived;
          vaultReduce = fullPaid;
        } else if (isBNPL) {
          vaultAdd = fullReceived;
          vaultReduce = actualPaid;
        } else {
          vaultAdd = actualReceived;
          vaultReduce = actualPaid;
        }

        if (buyCid) {
          if (!currencyTotals[buyCid]) currencyTotals[buyCid] = { expected: 0, actual: 0 };
          currencyTotals[buyCid].expected += vaultAdd;
        }
        if (sellCid) {
          if (!currencyTotals[sellCid]) currencyTotals[sellCid] = { expected: 0, actual: 0 };
          currencyTotals[sellCid].expected -= vaultReduce;
        }
      } else {
        const buyCid = deal.buy_currency_id;
        const sellCid = deal.sell_currency_id;
        const amount = Number(deal.amount || 0);
        const amountToBePaid = Number(deal.amount_to_be_paid || 0);

        if (matchingReceivedItems.length > 0) {
          // Use actual received items
          matchingReceivedItems.forEach(item => {
            const cid = item.currency_id;
            if (!currencyTotals[cid]) currencyTotals[cid] = { expected: 0, actual: 0 };
            currencyTotals[cid].expected += Number(item.total || 0);
          });
        } else if (isSameDayDeal) {
          // No received items — use the full deal amount for the received side
          if (deal.deal_type === "buy") {
            if (buyCid) {
              if (!currencyTotals[buyCid]) currencyTotals[buyCid] = { expected: 0, actual: 0 };
              currencyTotals[buyCid].expected += amount;
            }
          } else if (deal.deal_type === "sell") {
            if (buyCid) {
              if (!currencyTotals[buyCid]) currencyTotals[buyCid] = { expected: 0, actual: 0 };
              currencyTotals[buyCid].expected += amountToBePaid;
            }
          }
        }

        if (matchingPaidItems.length > 0) {
          // Use actual paid items
          matchingPaidItems.forEach(item => {
            const cid = item.currency_id;
            if (!currencyTotals[cid]) currencyTotals[cid] = { expected: 0, actual: 0 };
            currencyTotals[cid].expected -= Number(item.total || 0);
          });
        } else if (isSameDayDeal) {
          // No paid items — use the full deal amount for the paid side
          if (deal.deal_type === "buy") {
            if (sellCid) {
              if (!currencyTotals[sellCid]) currencyTotals[sellCid] = { expected: 0, actual: 0 };
              currencyTotals[sellCid].expected -= amountToBePaid;
            }
          } else if (deal.deal_type === "sell") {
            if (sellCid) {
              if (!currencyTotals[sellCid]) currencyTotals[sellCid] = { expected: 0, actual: 0 };
              currencyTotals[sellCid].expected -= amount;
            }
          }
        }
      }
    });

    // Automatically update closing entries to match expected book balance ONLY if deals exist
    // This allows start-of-day (login time) to stay with empty closing vault until business activity starts.
    let hasDeals = (updatedReconciliation.deals || []).length > 0;
    let finalClosingEntriesFound = (updatedReconciliation.closingEntries || []).length > 0;

    if (hasDeals || finalClosingEntriesFound) {
      await getdb.reconciliationClosing.deleteMany({ where: { reconciliation_id: Number(id) } });

      const updatedClosingEntriesArr = [];
      Object.keys(currencyTotals).forEach(cid => {
        const expectedAmount = currencyTotals[cid].expected;
        if (Math.abs(expectedAmount) > 0.01) {
          updatedClosingEntriesArr.push({
            reconciliation_id: Number(id),
            currency_id: Number(cid),
            amount: Math.round(expectedAmount),
            quantity: 1,
            denomination: Math.round(expectedAmount),
            exchange_rate: 1.0
          });
        }
      });

      if (updatedClosingEntriesArr.length > 0) {
        logger.info(`Updating closing entries for recon ${id}: ${JSON.stringify(updatedClosingEntriesArr)}`);
        await getdb.reconciliationClosing.createMany({ data: updatedClosingEntriesArr });
        finalClosingEntriesFound = true;
      }
    }

    // Because actual is potentially set to expected, it's Tallied if we have closing records
    let finalStatus = finalClosingEntriesFound ? "Tallied" : "In_Progress";

    await getdb.reconciliation.update({
      where: { id: updatedReconciliation.id },
      data: { status: finalStatus, updated_at: new Date() }
    });

    logger.info(`Reconciliation status recalculated for ID ${id}. Final status: ${finalStatus}. Deals present: ${hasDeals}.`);

    try {
      const openSetRateService = require("./openSetRate.service");
      await openSetRateService.propagateAverageRateToNextDay(updatedReconciliation.created_at, userId);
    } catch (err) {
      logger.error("Failed to propagate rate on reconciliation update:", err);
    }

    return await getdb.reconciliation.findUnique({
      where: { id: updatedReconciliation.id },
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        notes: true,
        deals: { include: { deal: true } },
      },
    });
  } catch (error) {
    logger.error("Failed to recalculate reconciliation status:", error);
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
  userId = null,
  roleName = "",
  userOnly = false,
  reportType
}) => {
  try {
    const skip = (page - 1) * limit;
    const where = {};

    // ✅ ---------------- DATE HELPERS (LOCAL SAFE) ----------------
    const startOfDay = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const endOfDay = (date) => {
      const d = new Date(date);
      d.setHours(23, 59, 59, 999);
      return d;
    };

    let start, end;

    // ✅ ---------------- DATE FILTER FIX ----------------
    if (dateFilter) {
      const today = new Date();

      switch (dateFilter) {
        case "today":
          start = startOfDay(today);
          end = endOfDay(today);
          break;

        case "yesterday":
          const y = new Date();
          y.setDate(y.getDate() - 1);
          start = startOfDay(y);
          end = endOfDay(y);
          break;

        case "last7":
          const last7 = new Date();
          last7.setDate(last7.getDate() - 7);
          start = startOfDay(last7);
          end = endOfDay(today);
          break;

        case "last30":
          const last30 = new Date();
          last30.setDate(last30.getDate() - 30);
          start = startOfDay(last30);
          end = endOfDay(today);
          break;

        case "thisMonth":
          const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
          start = startOfDay(firstDay);
          end = endOfDay(today);
          break;

        case "custom":
          if (!startDate || !endDate) {
            throw new Error("Custom filter requires startDate & endDate");
          }
          start = startOfDay(new Date(startDate));
          end = endOfDay(new Date(endDate));
          break;

        default:
          throw new Error("Invalid dateFilter");
      }
    }

    if (status) where.status = status;

    if (start && end) {
      where.created_at = {
        gte: start,
        lte: end
      };
    }

    // ---------------- FETCH ----------------
    const total = await getdb.reconciliation.count({ where });

    const reconciliations = await getdb.reconciliation.findMany({
      where,
      include: {
        openingEntries: { include: { currency: true } },
        closingEntries: { include: { currency: true } },
        createdBy: { select: { id: true, full_name: true, email: true } },
        deals: {
          include: {
            deal: {
              include: {
                customer: true,
                buyCurrency: true,
                sellCurrency: true,
                receivedItems: true,
                paidItems: true
              }
            }
          }
        }
      },
      orderBy: { created_at: "desc" },
      skip: (format === "pdf" || format === "excel") ? undefined : skip,
      take: (format === "pdf" || format === "excel") ? undefined : limit
    });

    // ---------------- CALCULATIONS (ASYNC) ----------------
    const enhancedData = await Promise.all(reconciliations.map(async (rec) => {

      let totalTzsPaid = 0;
      let totalTzsReceived = 0;
      let totalForeignBought = 0;
      let totalForeignSold = 0;

      let totalUsdAmount = 0;
      let totalUsdValue = 0;

      rec.deals.forEach(rd => {
        const deal = rd.deal;
        if (!deal) return;

        let foreignAmount = Number(deal.amount || 0);
        let tzsAmount = Number(deal.amount_to_be_paid || 0);

        // ✅ Pending handling
        if (deal.status === "Pending") {
          foreignAmount = (deal.receivedItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
          tzsAmount = (deal.paidItems || []).reduce((s, i) => s + Number(i.total || 0), 0);

          if (deal.deal_type === "sell") {
            foreignAmount = (deal.paidItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
            tzsAmount = (deal.receivedItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
          }
        }

        const buyCode = deal.buyCurrency?.code;
        const sellCode = deal.sellCurrency?.code;

        // ✅ Weighted Avg
        if (deal.deal_type === "buy" && (buyCode === "USD" || sellCode === "USD")) {
          totalUsdAmount += foreignAmount;
          totalUsdValue += foreignAmount * Number(deal.exchange_rate || 0);
        }

        // BUY
        if (deal.deal_type === "buy" && buyCode !== "TZS") {
          totalTzsPaid += tzsAmount;
          totalForeignBought += foreignAmount;
        }

        // SELL
        if (deal.deal_type === "sell" && sellCode !== "TZS") {
          totalTzsReceived += tzsAmount;
          totalForeignSold += foreignAmount;
        }
      });

      const valuationRate = totalUsdAmount > 0
        ? totalUsdValue / totalUsdAmount
        : 0;

      // ---------------- OPENING ----------------
      const { previousRate } = await openSetRateService.getOpenSetRates(rec.created_at);

      let openingUSD = 0, openingTZS = 0;

      rec.openingEntries.forEach(o => {
        if (o.currency.code === "USD") openingUSD += Number(o.amount || 0);
        if (o.currency.code === "TZS") openingTZS += Number(o.amount || 0);
      });

      const openingRate = previousRate || valuationRate || 0;
      const totalOpeningValue = (openingUSD * openingRate) + openingTZS;

      // ---------------- CLOSING ----------------
      let closingUSD = 0, closingTZS = 0;

      rec.closingEntries.forEach(c => {
        if (c.currency.code === "USD") closingUSD += Number(c.amount || 0);
        if (c.currency.code === "TZS") closingTZS += Number(c.amount || 0);
      });

      // Closing Rate defaults to today's valuationRate, but if no deals today, use openingRate
      const closingRate = valuationRate || openingRate || 0;
      const totalClosingValue = (closingUSD * closingRate) + closingTZS;

      // ---------------- PROFIT ----------------
      const profitLoss = (totalClosingValue - totalOpeningValue);

      return {
        ...rec,
        totalTzsPaid: Math.round(totalTzsPaid),
        totalTzsReceived: Math.round(totalTzsReceived),
        totalForeignBought: Number(totalForeignBought.toFixed(2)),
        totalForeignSold: Number(totalForeignSold.toFixed(2)),
        total_transactions: rec.deals.length,
        valuationRate: Math.round(valuationRate),
        openingRate: Math.round(openingRate), // Explicitly return opening rate
        totalOpeningValue: Math.round(totalOpeningValue),
        totalClosingValue: Math.round(totalClosingValue),
        profitLoss: Math.round(profitLoss)
      };
    }));

    // ---------------- EXPORT ----------------
    if (format === "excel") {
      const filePath = await generateExcel(enhancedData, { reportType });
      return { filePath };
    }

    if (format === "pdf") {
      let downloadingUser = null;
      if (userId) {
        downloadingUser = await getdb.user.findUnique({
          where: { id: Number(userId) },
          select: { full_name: true, phone_number: true, email: true }
        });
      }
      const filePath = await generatePDF(enhancedData, { startDate, endDate, user: downloadingUser, reportType });
      return { filePath };
    }

    // ---------------- RESPONSE ----------------
    return {
      message: "Reconciliations fetched successfully",
      data: enhancedData,
      pagination: {
        total,
        page,
        limit,
        totalPages: total ? Math.ceil(total / limit) : 0
      }
    };

  } catch (error) {
    console.error("Reconciliation error:", error);
    throw error;
  }
};
// const getAllReconciliations = async ({
//   page = 1,
//   limit = 10,
//   dateFilter,
//   startDate,
//   endDate,
//   status,
//   format,
//   userId = null,
//   roleName = "",
//   userOnly = false
// }) => {
//   try {
//     const skip = (page - 1) * limit;
//     const where = {};

//     const now = new Date();
//     let start, end;

//     // ---------------- DATE FILTER ----------------
//     if (dateFilter) {
//       switch (dateFilter) {
//         case "today":
//           start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
//           end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
//           break;

//         case "custom":
//           if (!startDate || !endDate) throw new Error("Custom dates required");
//           start = new Date(startDate);
//           end = new Date(endDate);
//           break;
//       }
//     }

//     if (status) where.status = status;
//     if (start && end) where.created_at = { gte: start, lte: end };

//     const total = await getdb.reconciliation.count({ where });

//     const reconciliations = await getdb.reconciliation.findMany({
//       where,
//       include: {
//         openingEntries: { include: { currency: true } },
//         closingEntries: { include: { currency: true } },
//         deals: {
//           include: {
//             deal: {
//               include: {
//                 customer: { select: { name: true } },
//                 buyCurrency: true,
//                 sellCurrency: true,
//                 receivedItems: true,
//                 paidItems: true,
//               },
//             },
//           },
//         },
//       },
//       orderBy: { created_at: "desc" },
//       skip: format ? undefined : skip,
//       take: format ? undefined : limit,
//     });

//     const enhancedData = reconciliations.map((rec) => {
//       let totalTzsPaid = 0;
//       let totalTzsReceived = 0;
//       let totalForeignBought = 0;
//       let totalForeignSold = 0;

//       // ---------------- DEAL LOOP ----------------
//       rec.deals.forEach((rd) => {
//         const deal = rd.deal;
//         if (!deal) return;

//         let foreignAmount = Number(deal.amount || 0);
//         let tzsAmount = Number(deal.amount_to_be_paid || 0);

//         // Pending deals fix
//         if (deal.status === "Pending") {
//           foreignAmount = (deal.receivedItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
//           tzsAmount = (deal.paidItems || []).reduce((s, i) => s + Number(i.total || 0), 0);

//           if (deal.deal_type === "sell") {
//             foreignAmount = (deal.paidItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
//             tzsAmount = (deal.receivedItems || []).reduce((s, i) => s + Number(i.total || 0), 0);
//           }
//         }

//         const buyCode = deal.buyCurrency?.code;
//         const sellCode = deal.sellCurrency?.code;

//         // BUY
//         if (deal.deal_type === "buy" && buyCode !== "TZS") {
//           totalTzsPaid += tzsAmount;
//           totalForeignBought += foreignAmount;
//         }

//         // SELL
//         if (deal.deal_type === "sell" && sellCode !== "TZS") {
//           totalTzsReceived += tzsAmount;
//           totalForeignSold += foreignAmount;
//         }
//       });

//       // ---------------- ✅ FIXED RATE ----------------

//       // Weighted Average (BUY ONLY)
//       const valuationRate =
//         totalForeignBought > 0
//           ? totalTzsPaid / totalForeignBought
//           : 0;

//       // ---------------- OPENING / CLOSING ----------------
//       let openingUSD = 0, openingTZS = 0;
//       rec.openingEntries.forEach(o => {
//         if (o.currency.code === "USD") openingUSD += Number(o.amount || 0);
//         if (o.currency.code === "TZS") openingTZS += Number(o.amount || 0);
//       });

//       let closingUSD = 0, closingTZS = 0;
//       rec.closingEntries.forEach(c => {
//         if (c.currency.code === "USD") closingUSD += Number(c.amount || 0);
//         if (c.currency.code === "TZS") closingTZS += Number(c.amount || 0);
//       });

//       // Use valuation rate directly
//       const openingRate = valuationRate;
//       const closingRate = valuationRate;

//       const totalOpeningValue = openingUSD * openingRate + openingTZS;
//       const totalClosingValue = closingUSD * closingRate + closingTZS;

//       // Simplified PnL formula matching spreadsheet
//       const profitLoss = totalClosingValue - totalOpeningValue;

//       return {
//         ...rec,
//         totalTzsPaid,
//         totalTzsReceived,
//         totalForeignBought,
//         totalForeignSold,
//         total_transactions: rec.deals.length,
//         totalOpeningValue,
//         totalClosingValue,
//         valuationRate,
//         profitLoss,
//       };
//     });

//     return {
//       data: enhancedData,
//       total
//     };

//   } catch (error) {
//     logger.error("Failed to fetch reconciliations:", error);
//     throw error;
//   }
// };

const generateExcel = async (recs, options = {}) => {
  const { reportType } = options;
  const isPnlReport = reportType === "P&L";
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(isPnlReport ? "P&L Report" : "Reconciliation Report");

  if (isPnlReport) {
    sheet.columns = [
      { header: "Date", key: "date", width: 15 },
      { header: "Created By", key: "created_by", width: 20 },
      { header: "Total Deals", key: "total_deals", width: 15 },
      { header: "Open Rate", key: "open_rate", width: 15 },
      { header: "Close Rate", key: "close_rate", width: 15 },
      { header: "Opening Balance (TZS)", key: "opening_bal", width: 25 },
      { header: "Closing Balance (TZS)", key: "closing_bal", width: 25 },
      { header: "Profit / Loss (TZS)", key: "profit_loss", width: 25 },
    ];
  } else {
    sheet.columns = [
      { header: "Status", key: "status", width: 15 },
      { header: "Date", key: "date", width: 15 },
      { header: "Opening Vault", key: "opening_vault", width: 40 },
      { header: "Closing Vault", key: "closing_vault", width: 40 },
      { header: "Created By", key: "created_by", width: 20 },
    ];
  }

  recs.forEach((r) => {
    const openingByCurr = {};
    (r.openingEntries || []).forEach(o => {
      const code = o.currency?.code || "?";
      openingByCurr[code] = (openingByCurr[code] || 0) + Number(o.amount || 0);
    });
    const openingStr = Object.entries(openingByCurr)
      .map(([code, amt]) => `${Number(amt).toLocaleString()} ${code}`)
      .join("; ");

    const closingByCurr = {};
    (r.closingEntries || []).forEach(c => {
      const code = c.currency?.code || "?";
      closingByCurr[code] = (closingByCurr[code] || 0) + Number(c.amount || 0);
    });
    const closingStr = Object.entries(closingByCurr)
      .map(([code, amt]) => `${Number(amt).toLocaleString()} ${code}`)
      .join("; ");

    const notesStr = (r.notes || []).map((n) => n.note).join("; ");

    if (isPnlReport) {
      sheet.addRow({
        date: formatDateDDMMYYYY(r.created_at),
        created_by: r.createdBy?.full_name,
        total_deals: r.deals?.length || 0,
        open_rate: Number(r.openingRate || 0).toLocaleString(),
        close_rate: Number(r.valuationRate || 0).toLocaleString(),
        opening_bal: Number(r.totalOpeningValue || 0).toLocaleString(),
        closing_bal: Number(r.totalClosingValue || 0).toLocaleString(),
        profit_loss: Number(r.profitLoss || 0).toLocaleString(),
        notes: notesStr,
      });
    } else {
      sheet.addRow({
        status: r.status,
        date: formatDateDDMMYYYY(r.created_at),
        opening_vault: openingStr,
        closing_vault: closingStr,
        created_by: r.createdBy?.full_name,
        notes: notesStr,
      });
    }
  });

  const folder = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(folder)) {
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

const generatePDF = async (recs, options = {}) => {
  let folder = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(folder)) {
    folder = path.join(__dirname, "../downloads");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  }
  const filePath = path.join(folder, `reconciliation_report_${Date.now()}.pdf`);
  const doc = new PDFDocument({ margin: 30, size: "A4", layout: "portrait", bufferPages: true });

  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  // 🎨 COLORS & CONSTANTS (Professional Blue Theme)
  const PRIMARY_COLOR = "#1D4CB5";
  const TEXT_COLOR = "#333333";
  const SECONDARY_TEXT = "#666666";
  const BORDER_COLOR = "#EEEEEE";
  const WHITE = "#FFFFFF";

  const { startDate, endDate, reportType } = options;
  const isPnlReport = reportType === "P&L";

  const dateRangeStr = startDate && endDate 
    ? `From ${formatDateDDMMYYYY(startDate)} To ${formatDateDDMMYYYY(endDate)}`
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

  // --- 🏢 TITLE SECTION ---
  doc.fillColor(TEXT_COLOR).fontSize(14).font("Helvetica-Bold").text(isPnlReport ? "P&L Report" : "Reconciliation Report", 30, 100);
  doc.fontSize(8).font("Helvetica").fillColor(SECONDARY_TEXT).text(dateRangeStr, 30, 120);

  // --- 🛒 COMPACT TABLE (DYNAMIC COLUMNS) ---
  const COLUMN_WIDTHS = isPnlReport ? {
    date: 60,
    by: 60,
    deals: 35,
    openRate: 65,
    closeRate: 65,
    openingVal: 90,
    closingVal: 90,
    pnl: 70
  } : {
    status: 80,
    date: 85,
    openingVault: 150,
    closingVault: 150,
    by: 70
  };

  const drawTableHeader = (y) => {
    doc.rect(30, y, 535, 25).fill(PRIMARY_COLOR);
    doc.fillColor(WHITE).fontSize(7).font("Helvetica-Bold");
    let currentX = 35;
    if (isPnlReport) {
      doc.text("Date", currentX, y + 9); currentX += COLUMN_WIDTHS.date;
      doc.text("Created By", currentX, y + 9); currentX += COLUMN_WIDTHS.by;
      doc.text("Deals", currentX, y + 9); currentX += COLUMN_WIDTHS.deals;
      doc.text("Open Rate", currentX, y + 9); currentX += COLUMN_WIDTHS.openRate;
      doc.text("Close Rate", currentX, y + 9); currentX += COLUMN_WIDTHS.closeRate;
      doc.text("Open Bal", currentX, y + 9); currentX += COLUMN_WIDTHS.openingVal;
      doc.text("Close Bal", currentX, y + 9); currentX += COLUMN_WIDTHS.closingVal;
      doc.text("P&L (TZS)", currentX, y + 9);
    } else {
      doc.text("Status", currentX, y + 9); currentX += COLUMN_WIDTHS.status;
      doc.text("Date", currentX, y + 9); currentX += COLUMN_WIDTHS.date;
      doc.text("Opening Vault", currentX, y + 9); currentX += COLUMN_WIDTHS.openingVault;
      doc.text("Closing Vault", currentX, y + 9); currentX += COLUMN_WIDTHS.closingVault;
      doc.text("Created By", currentX, y + 9);
    }
  };

  let currentY = 145;
  drawTableHeader(currentY);
  currentY += 30;

  recs.forEach((r, index) => {
    const openingByCurr = {};
    (r.openingEntries || []).forEach(o => {
      const code = o.currency?.code || "?";
      openingByCurr[code] = (openingByCurr[code] || 0) + Number(o.amount || 0);
    });
    const openingEntriesList = Object.entries(openingByCurr)
      .map(([code, amt]) => `${Number(amt).toLocaleString()} ${code}`);
    const openingVaultStr = openingEntriesList.join("\n") || "—";

    const closingByCurr = {};
    (r.closingEntries || []).forEach(c => {
      const code = c.currency?.code || "?";
      closingByCurr[code] = (closingByCurr[code] || 0) + Number(c.amount || 0);
    });
    const closingEntriesList = Object.entries(closingByCurr)
      .map(([code, amt]) => `${Number(amt).toLocaleString()} ${code}`);
    const closingVaultStr = closingEntriesList.join("\n") || "—";

    const lineCount = isPnlReport ? 1 : Math.max(openingEntriesList.length, closingEntriesList.length, 1);
    const rowHeight = isPnlReport ? 18 : Math.max(18, lineCount * 9 + 4);

    if (currentY + rowHeight > 740) {
      doc.addPage();
      currentY = 40;
      drawTableHeader(currentY);
      currentY += 30;
    }

    doc.fillColor(TEXT_COLOR).fontSize(7).font("Helvetica");
    if (index % 2 === 1) {
      doc.rect(30, currentY - 4, 535, rowHeight).fill("#F7F9FF");
      doc.fillColor(TEXT_COLOR);
    }

    let currentX = 35;
    if (isPnlReport) {
      doc.text(formatDateDDMMYYYY(r.created_at), currentX, currentY); currentX += COLUMN_WIDTHS.date;
      const creatorName = (r.createdBy?.full_name || "N/A").split(" ")[0];
      doc.text(creatorName, currentX, currentY); currentX += COLUMN_WIDTHS.by;
      doc.text((r.deals?.length || 0).toString(), currentX, currentY); currentX += COLUMN_WIDTHS.deals;
      doc.text(Number(r.openingRate || 0).toLocaleString(), currentX, currentY); currentX += COLUMN_WIDTHS.openRate;
      doc.text(Number(r.valuationRate || 0).toLocaleString(), currentX, currentY); currentX += COLUMN_WIDTHS.closeRate;
      doc.text(Number(r.totalOpeningValue || 0).toLocaleString(), currentX, currentY); currentX += COLUMN_WIDTHS.openingVal;
      doc.text(Number(r.totalClosingValue || 0).toLocaleString(), currentX, currentY); currentX += COLUMN_WIDTHS.closingVal;
      
      const pnl = Number(r.profitLoss || 0);
      doc.fillColor(pnl >= 0 ? TEXT_COLOR : "#D93025").text(`${pnl >= 0 ? "+" : ""}${pnl.toLocaleString()}`, currentX, currentY);
    } else {
      doc.text(r.status, currentX, currentY); currentX += COLUMN_WIDTHS.status;
      doc.text(formatDateDDMMYYYY(r.created_at), currentX, currentY); currentX += COLUMN_WIDTHS.date;
      doc.text(openingVaultStr, currentX, currentY, { width: COLUMN_WIDTHS.openingVault - 5 }); currentX += COLUMN_WIDTHS.openingVault;
      doc.text(closingVaultStr, currentX, currentY, { width: COLUMN_WIDTHS.closingVault - 5 }); currentX += COLUMN_WIDTHS.closingVault;
      const creatorName = (r.createdBy?.full_name || "N/A").split(" ")[0];
      doc.text(creatorName, currentX, currentY);
    }

    currentY += rowHeight;
  });

  const drawFooter = (docInst, pageNum, totalPages) => {
    const footerY = docInst.page.height - 80;
    docInst.moveTo(30, footerY).lineTo(docInst.page.width - 30, footerY).strokeColor(BORDER_COLOR).stroke();
    docInst.fillColor(TEXT_COLOR).fontSize(9).font("Helvetica-Bold").text("Notes & Remarks :", 30, footerY + 10);
    docInst.fillColor(SECONDARY_TEXT).fontSize(7).font("Helvetica");
    docInst.text("All reconciliation values are subject to manager audit.", 30, footerY + 22);
    docInst.fontSize(7).text(`Page ${pageNum} of ${totalPages}`, docInst.page.width - 60, footerY + 55);
  };

  let pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i + 1, pages.count);
  }

  doc.end();
  return new Promise((resolve) => { writeStream.on("finish", () => resolve(filePath)); });
};

const getReconciliationById = async (id, userId = null, roleName = "") => {
  try {
    const rec = await getdb.reconciliation.findUnique({
      where: { id: Number(id) },
      include: {
        openingEntries: {
          include: { currency: { select: { id: true, code: true, name: true } } }
        },
        closingEntries: {
          include: { currency: { select: { id: true, code: true, name: true } } }
        },
        notes: true,
        deals: {
          include: {
            deal: {
              include: {
                customer: { select: { name: true } },
                buyCurrency: { select: { id: true, code: true, name: true } },
                sellCurrency: { select: { id: true, code: true, name: true } },
                receivedItems: true,
                paidItems: true
              }
            }
          }
        },
        createdBy: { select: { id: true, full_name: true, email: true } }
      }
    });

    if (!rec) throw new Error("Reconciliation not found");

    // Reconciliation is now shared across all users

    // AGGREGATION VARIABLES
    let totalTzsPaid = 0;
    let totalTzsReceived = 0;
    let totalForeignBought = 0;
    let totalForeignSold = 0;

    let totalTzsDifference = 0;
    let totalForeignDifference = 0;

    const currencyStats = {};

    const reconDate = rec.created_at ? new Date(rec.created_at).toISOString().split('T')[0] : "";

    // PROCESS DEALS
    for (const dealRec of rec.deals) {
      const deal = dealRec.deal;
      const dealDate = deal.pre_date ? new Date(deal.pre_date).toISOString().split('T')[0] : "";
      const isSameDayDeal = dealDate === reconDate;

      const matchingReceivedItems = (deal.receivedItems || []).filter(item => {
        if (!item.created_at) return true;
        return new Date(item.created_at).toISOString().split('T')[0] === reconDate;
      });
      const matchingPaidItems = (deal.paidItems || []).filter(item => {
        if (!item.created_at) return true;
        return new Date(item.created_at).toISOString().split('T')[0] === reconDate;
      });

      let scheduledAmount = Number(deal.amount || 0) * (isSameDayDeal ? 1 : 0);
      let scheduledTzs = Number(deal.amount_to_be_paid || 0) * (isSameDayDeal ? 1 : 0);

      let foreignAmount = scheduledAmount;
      let tzsAmount = scheduledTzs;

      if (deal.status === "Pending") {
        const isPNBL = deal.credit_type === 'PNBL';
        const isBNPL = deal.credit_type === 'BNPL';

        const actualReceived = matchingReceivedItems.reduce((sum, i) => sum + Number(i.total || 0), 0);
        const actualPaid = matchingPaidItems.reduce((sum, i) => sum + Number(i.total || 0), 0);

        if (isPNBL) {
          if (deal.deal_type === "buy") {
            foreignAmount = actualReceived;
            tzsAmount = scheduledTzs;
          } else {
            foreignAmount = scheduledAmount;
            tzsAmount = actualReceived;
          }
        } else if (isBNPL) {
          if (deal.deal_type === "buy") {
            foreignAmount = scheduledAmount;
            tzsAmount = actualPaid;
          } else {
            foreignAmount = actualPaid;
            tzsAmount = scheduledTzs;
          }
        } else {
          if (deal.deal_type === "buy") {
            foreignAmount = actualReceived;
            tzsAmount = actualPaid;
          } else {
            foreignAmount = actualPaid;
            tzsAmount = actualReceived;
          }
        }

        totalForeignDifference += (scheduledAmount - foreignAmount);
        totalTzsDifference += (scheduledTzs - tzsAmount);
      }

      const buyCode = deal.buyCurrency?.code;
      const sellCode = deal.sellCurrency?.code;
      const buyCid = deal.buy_currency_id;
      const sellCid = deal.sell_currency_id;

      // ---------------- BUY DEAL ----------------
      if (deal.deal_type === "buy" && buyCode !== "TZS") {
        totalTzsPaid += tzsAmount;
        totalForeignBought += foreignAmount;

        if (!currencyStats[buyCid]) {
          currencyStats[buyCid] = {
            code: buyCode,
            boughtAmount: 0,
            soldAmount: 0,
            tzsPaid: 0,
            tzsReceived: 0
          };
        }

        currencyStats[buyCid].boughtAmount += foreignAmount;
        currencyStats[buyCid].tzsPaid += tzsAmount;
      }

      // ---------------- SELL DEAL ----------------
      if (deal.deal_type === "sell" && sellCode !== "TZS") {
        totalTzsReceived += tzsAmount;
        totalForeignSold += foreignAmount;

        if (!currencyStats[sellCid]) {
          currencyStats[sellCid] = {
            code: sellCode,
            boughtAmount: 0,
            soldAmount: 0,
            tzsPaid: 0,
            tzsReceived: 0
          };
        }

        currencyStats[sellCid].soldAmount += foreignAmount;
        currencyStats[sellCid].tzsReceived += tzsAmount;
      }
    }

    // CALCULATE AVERAGES PER CURRENCY
    for (const cid in currencyStats) {
      const c = currencyStats[cid];

      c.avgBuyRate = c.boughtAmount
        ? c.tzsPaid / c.boughtAmount
        : 0;

      c.avgSellRate = c.soldAmount
        ? c.tzsReceived / c.soldAmount
        : 0;

      c.netPosition = c.boughtAmount - c.soldAmount;
    }

    // TOTAL WEIGHTED AVERAGE RATE
    const totalWeightedAvgRate =
      (totalTzsPaid + totalTzsReceived) /
      (totalForeignBought + totalForeignSold || 1);

    // VALUATION RATE (AVG BUY USD)
    const usdCurrency = Object.values(currencyStats).find(
      c => c.code === "USD"
    );

    const valuationRate = usdCurrency?.avgBuyRate || 0;

    // FETCH PREVIOUS RATE FOR OPENING
    const { previousRate } = await openSetRateService.getOpenSetRates(rec.created_at);
    const openingRate = previousRate || valuationRate || 0;

    // OPENING / CLOSING BALANCES
    let openingUSD = 0;
    let openingTZS = 0;
    let closingUSD = 0;
    let closingTZS = 0;

    for (const o of rec.openingEntries) {
      if (o.currency.code === "USD") openingUSD += Number(o.amount);
      if (o.currency.code === "TZS") openingTZS += Number(o.amount);
    }

    for (const c of rec.closingEntries) {
      if (c.currency.code === "USD") closingUSD += Number(c.amount);
      if (c.currency.code === "TZS") closingTZS += Number(c.amount);
    }

    const totalOpeningValue = openingUSD * openingRate + openingTZS;
    const totalClosingValue = closingUSD * valuationRate + closingTZS;

    const totalValueOut = totalTzsPaid + (totalForeignSold * valuationRate);
    const totalValueIn = totalTzsReceived + (totalForeignBought * valuationRate);

    const profitLoss = (totalClosingValue + totalValueOut) - (totalOpeningValue + totalValueIn);

    // Fields used in list view
    const opening_total = totalOpeningValue;
    const closing_total = totalClosingValue;
    const total_transactions = rec.deals.length;

    return {
      ...rec,
      totalTzsPaid: Math.round(totalTzsPaid),
      totalTzsReceived: Math.round(totalTzsReceived),
      totalForeignBought: Number(totalForeignBought.toFixed(2)),
      totalForeignSold: Number(totalForeignSold.toFixed(2)),
      totalTzsDifference: Math.round(totalTzsDifference),
      totalForeignDifference: Number(totalForeignDifference.toFixed(2)),
      totalWeightedAvgRate: Math.round(totalWeightedAvgRate),
      valuationRate: Math.round(valuationRate),
      currencyStats,
      totalOpeningValue: Math.round(totalOpeningValue),
      totalClosingValue: Math.round(totalClosingValue),
      profitLoss: Math.round(profitLoss),
      opening_total: Math.round(opening_total),
      closing_total: Math.round(closing_total),
      total_transactions,
    };
  } catch (error) {
    logger.error("❌ Failed to fetch reconciliation by ID:", error);
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
        deals: { include: { deal: true } },
      },
    });

    if (hasClosing) {
      await mapDailyDeals(id, userId);
      return await startReconciliation(id, userId);
    }

    return updatedReconciliation;
  } catch (error) {
    console.error("Failed to update reconciliation:", error);
    throw error;
  }
};

const syncReconciliationCascade = async (startDate, userId) => {
  try {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    // 1. Get all reconciliations from the startDate onwards
    const reconciliations = await getdb.reconciliation.findMany({
      where: {
        created_at: { gte: start },
      },
      orderBy: { created_at: "asc" },
      include: {
        openingEntries: true,
        closingEntries: { include: { currency: true } },
      },
    });

    if (reconciliations.length === 0) {
      logger.info(`No reconciliations found from ${startDate} onwards to cascade.`);
      return;
    }

    logger.info(`Starting cascading sync for ${reconciliations.length} reconciliations from ${startDate}`);

    let previousClosingEntries = null;

    for (let i = 0; i < reconciliations.length; i++) {
      const current = reconciliations[i];

      // Step A: Update Opening Entries if we have a previous closed reconciliation
      if (previousClosingEntries) {
        logger.info(`Updating opening entries for recon ${current.id} from previous closing.`);

        // Delete existing opening entries
        await getdb.reconciliationOpening.deleteMany({
          where: { reconciliation_id: current.id }
        });

        // Create new opening entries from previous closing
        await getdb.reconciliationOpening.createMany({
          data: previousClosingEntries.map(e => ({
            reconciliation_id: current.id,
            currency_id: e.currency_id,
            amount: e.amount,
            denomination: e.denomination || e.amount || 0,
            quantity: e.quantity || 1,
            exchange_rate: e.exchange_rate || 1.0,
          }))
        });
      }

      // Step B: Map any new deals for this day that might have been missed (e.g. back-dated)
      await mapDailyDeals(current.id, userId);

      // Step C: Recalculate this reconciliation's closing balance and status
      const updated = await calculateAndSetReconciliationStatus(current.id, userId);

      // Step D: Store the updated closing entries for the next in chain
      previousClosingEntries = updated.closingEntries;
    }

    logger.info("Cascading sync completed successfully.");
  } catch (error) {
    logger.error("Failed to sync reconciliation cascade:", error);
    throw error;
  }
};

module.exports = {
  createReconciliation,
  getAllReconciliations,
  getReconciliationById,
  updateReconciliation,
  startReconciliation,
  getCurrentDayReconciliation,
  calculateAndSetReconciliationStatus,
  syncReconciliationCascade,
};
