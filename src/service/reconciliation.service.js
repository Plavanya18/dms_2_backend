const { getdb } = require("../config/db");
const logger = require("../config/logger");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const os = require("os");

// ✅ Standardized date formatter to prevent timezone shifts (YYYY-MM-DD)
const formatDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  // Using getUTC* to ensure consistency across servers, as pre_date/created_at are stored as UTC
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  userOnly = false
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

        case "last30":
          start = new Date(now);
          start.setDate(now.getDate() - 30);
          start.setHours(0, 0, 0, 0);
          end = new Date(now.setHours(23, 59, 59, 999));
          break;

        case "last90":
          start = new Date(now);
          start.setDate(now.getDate() - 90);
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

    if (start && end) {
      where.created_at = { gte: start, lte: end };
    }

    const total = await getdb.reconciliation.count({ where });

    const reconciliations = await getdb.reconciliation.findMany({
      where,
      include: {
        openingEntries: {
          include: {
            currency: { select: { id: true, code: true, name: true } }
          }
        },
        closingEntries: {
          include: {
            currency: { select: { id: true, code: true, name: true } }
          }
        },
        notes: true,
        deals: {
          include: {
            deal: {
              include: {
                customer: { select: { name: true } },
                buyCurrency: { select: { id: true, code: true, name: true } },
                sellCurrency: { select: { id: true, code: true, name: true } },
                createdBy: { select: { id: true, full_name: true, email: true } },
                receivedItems: { include: { currency: { select: { id: true, code: true } } } },
                paidItems: { include: { currency: { select: { id: true, code: true } } } }
              }
            }
          }
        },
        createdBy: { select: { id: true, full_name: true, email: true } }
      },
      orderBy: { created_at: "desc" },
      skip: (format === "pdf" || format === "excel") ? undefined : skip,
      take: (format === "pdf" || format === "excel") ? undefined : limit
    });

    // ✅ Normalize reconciliation dates (FIX)
    const reconciliationDates = [
      ...new Set(reconciliations.map(r => formatDate(r.created_at)))
    ];

    const openSetRates = await getdb.openSetRate.findMany({
      where: {
        date: {
          in: reconciliationDates.map(d => new Date(d))
        }
      },
      include: { currency: true }
    });

    // ✅ Normalize mapping (FIX)
    const ratesByDate = openSetRates.reduce((acc, rate) => {
      const dateKey = formatDate(rate.date);

      if (!acc[dateKey]) acc[dateKey] = {};
      acc[dateKey][rate.currency.code] = rate;

      return acc;
    }, {});

    const enhancedData = reconciliations.map((rec) => {
      const dateKey = formatDate(rec.created_at);

      let totalTzsPaid = 0;
      let totalTzsReceived = 0;
      let totalForeignBought = 0;
      let totalForeignSold = 0;

      let usdDealsCount = 0;
      let sumUsdRates = 0;

      rec.deals.forEach(rd => {
        const deal = rd.deal;
        if (!deal) return;

        let foreignAmount = Number(deal.amount || 0);
        let tzsAmount = Number(deal.amount_to_be_paid || 0);

        if (deal.status === "Pending") {
          foreignAmount = (deal.receivedItems || []).reduce((sum, itm) => sum + Number(itm.total || 0), 0);
          tzsAmount = (deal.paidItems || []).reduce((sum, itm) => sum + Number(itm.total || 0), 0);

          if (deal.deal_type === "sell") {
            foreignAmount = (deal.paidItems || []).reduce((sum, itm) => sum + Number(itm.total || 0), 0);
            tzsAmount = (deal.receivedItems || []).reduce((sum, itm) => sum + Number(itm.total || 0), 0);
          }
        }

        const buyCode = deal.buyCurrency?.code;
        const sellCode = deal.sellCurrency?.code;

        if (deal.deal_type === "buy" && (buyCode === "USD" || sellCode === "USD")) {
          usdDealsCount++;
          sumUsdRates += Number(deal.exchange_rate || 0);
        }

        if (deal.deal_type === "buy" && buyCode !== "TZS") {
          totalTzsPaid += tzsAmount;
          totalForeignBought += foreignAmount;
        }

        if (deal.deal_type === "sell" && sellCode !== "TZS") {
          totalTzsReceived += tzsAmount;
          totalForeignSold += foreignAmount;
        }
      });

      const valuationRate = usdDealsCount > 0 ? sumUsdRates / usdDealsCount : 0;

      // Manual Rate (Opening Set Rate): Use the TZS record from the opensetrate table
      const tzsRates = ratesByDate[dateKey]?.["TZS"];
      const manualRate = tzsRates ? Number(tzsRates.set_rate) : 0;

      // Requirement: Opening uses manual rate, Closing uses average (if deals exist)
      const openingRate = manualRate || valuationRate;
      const closingRate = usdDealsCount > 0 ? valuationRate : (manualRate || 0);

      let openingUSD = 0, openingTZS = 0;
      rec.openingEntries.forEach(o => {
        if (o.currency.code === "USD") openingUSD += Number(o.amount || 0);
        else if (o.currency.code === "TZS") openingTZS += Number(o.amount || 0);
      });

      const totalOpeningValue = openingUSD * openingRate + openingTZS;

      let closingUSD = 0, closingTZS = 0;
      rec.closingEntries.forEach(c => {
        if (c.currency.code === "USD") closingUSD += Number(c.amount || 0);
        else if (c.currency.code === "TZS") closingTZS += Number(c.amount || 0);
      });

      const totalClosingValue = closingUSD * closingRate + closingTZS;

      const totalValueOut = totalTzsPaid + (totalForeignSold * closingRate);
      const totalValueIn = totalTzsReceived + (totalForeignBought * closingRate);

      const profitLoss = (totalClosingValue + totalValueOut) - (totalOpeningValue + totalValueIn);

      return {
        ...rec,
        totalTzsPaid,
        totalTzsReceived,
        totalForeignBought,
        totalForeignSold,
        total_transactions: rec.deals.length,
        totalOpeningValue,
        totalClosingValue,
        profitLoss,
        valuationRate,
        setRate: openingRate,
        hasCustomRates: !!tzsRates
      };
    });

    if (format === "excel") {
      const filePath = await generateExcel(enhancedData);
      return { filePath };
    }

    if (format === "pdf") {
      const filePath = await generatePDF(enhancedData);
      return { filePath };
    }

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    const todayRates = openSetRates.filter(r => formatDate(r.date) === formatDate(todayDate)).reduce((acc, rate) => {
      acc[rate.currency.code] = {
        setRate: Number(rate.set_rate)
      };
      return acc;
    }, {});

    const prevTzsRate = await getdb.openSetRate.findFirst({
      where: {
        date: { lt: todayDate },
        currency: { code: "TZS" }
      },
      orderBy: { date: "desc" }
    });

    return {
      data: enhancedData,
      total,
      todayRates,
      previousRate: prevTzsRate ? Number(prevTzsRate.set_rate) : 0
    };

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
    { header: "Date", key: "created_at", width: 20 },
    { header: "Created By", key: "created_by", width: 20 },
    { header: "Opening Entries", key: "opening_entries", width: 50 },
    { header: "Opening Book Balance (TZS)", key: "opening_book_balance", width: 30 },
    { header: "Closing Entries", key: "closing_entries", width: 50 },
    { header: "Closing Book Balance (TZS)", key: "closing_book_balance", width: 30 },
    { header: "Profit / Loss (TZS)", key: "profit_loss", width: 25 },
    { header: "Notes", key: "notes", width: 50 },
  ];

  recs.forEach((r) => {
    // Aggregate opening entries by currency code
    const openingByCurr = {};
    (r.openingEntries || []).forEach(o => {
      const code = o.currency?.code || "?";
      openingByCurr[code] = (openingByCurr[code] || 0) + Number(o.amount || 0);
    });
    const openingStr = Object.entries(openingByCurr)
      .map(([code, amt]) => `${Number(amt).toLocaleString()} ${code}`)
      .join("; ");

    // Aggregate closing entries by currency code
    const closingByCurr = {};
    (r.closingEntries || []).forEach(c => {
      const code = c.currency?.code || "?";
      closingByCurr[code] = (closingByCurr[code] || 0) + Number(c.amount || 0);
    });
    const closingStr = Object.entries(closingByCurr)
      .map(([code, amt]) => `${Number(amt).toLocaleString()} ${code}`)
      .join("; ");

    const notesStr = (r.notes || []).map((n) => n.note).join("; ");

    sheet.addRow({
      id: r.id,
      status: r.status,
      created_at: new Date(r.created_at).toISOString().split("T")[0],
      created_by: r.createdBy?.full_name,
      opening_entries: openingStr,
      opening_book_balance: Number(r.totalOpeningValue || 0).toLocaleString(),
      closing_entries: closingStr,
      closing_book_balance: Number(r.totalClosingValue || 0).toLocaleString(),
      profit_loss: Number(r.profitLoss || 0).toLocaleString(),
      notes: notesStr,
    });
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

const generatePDF = async (recs) => {
  let folder = path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(folder)) {
    folder = path.join(__dirname, "../downloads");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  }
  const filePath = path.join(folder, `reconciliations_${Date.now()}.pdf`);
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  doc.fontSize(18).text("Reconciliation Report", { underline: true });
  doc.moveDown(1);

  recs.forEach((r) => {
    // Aggregate opening entries by currency code
    const openingByCurr = {};
    (r.openingEntries || []).forEach(o => {
      const code = o.currency?.code || "?";
      openingByCurr[code] = (openingByCurr[code] || 0) + Number(o.amount || 0);
    });
    const openingStr = Object.entries(openingByCurr)
      .map(([code, amt]) => `${Number(amt).toLocaleString()} ${code}`)
      .join("; ") || "—";

    // Aggregate closing entries by currency code
    const closingByCurr = {};
    (r.closingEntries || []).forEach(c => {
      const code = c.currency?.code || "?";
      closingByCurr[code] = (closingByCurr[code] || 0) + Number(c.amount || 0);
    });
    const closingStr = Object.entries(closingByCurr)
      .map(([code, amt]) => `${Number(amt).toLocaleString()} ${code}`)
      .join("; ") || "—";

    const openingBalance = Number(r.totalOpeningValue || 0).toLocaleString();
    const closingBalance = Number(r.totalClosingValue || 0).toLocaleString();
    const pnl = Number(r.profitLoss || 0).toLocaleString();
    const pnlSign = Number(r.profitLoss || 0) >= 0 ? "+" : "";

    const notesStr = (r.notes || []).map((n) => n.note).join("; ") || "—";
    const createdAt = new Date(r.created_at).toISOString().split("T")[0];

    doc.fontSize(12)
      .text(`ID: ${r.id}`)
      .text(`Status: ${r.status}`)
      .text(`Date: ${createdAt}`)
      .text(`Created By: ${r.createdBy?.full_name || "—"}`);

    doc.moveDown(0.3);
    doc.text(`Opening Entries: ${openingStr}`);
    doc.text(`Opening Book Balance: ${openingBalance} TZS`);

    doc.moveDown(0.3);
    doc.text(`Closing Entries: ${closingStr}`);
    doc.text(`Closing Book Balance: ${closingBalance} TZS`);

    doc.moveDown(0.3);
    doc.text(`Profit / Loss: ${pnlSign}${pnl} TZS`);

    doc.moveDown(1);
    doc.text("---------------------------------------------");
    doc.moveDown(1);
  });

  doc.end();

  return new Promise((resolve) => {
    writeStream.on("finish", () => resolve(filePath));
  });
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

    const totalOpeningValue = openingUSD * valuationRate + openingTZS;
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
      totalTzsPaid,
      totalTzsReceived,
      totalForeignBought,
      totalForeignSold,
      totalTzsDifference,
      totalForeignDifference,
      totalWeightedAvgRate,
      valuationRate,
      currencyStats,
      totalOpeningValue,
      totalClosingValue,
      profitLoss,
      opening_total,
      closing_total,
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
