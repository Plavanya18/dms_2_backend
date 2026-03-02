const { getdb } = require("../config/db");
const logger = require("../config/logger");

/**
 * Syncs alerts from Reconciliations and Deals into the Notification table.
 */
const syncNotifications = async (userId) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. Fetch Short/Excess Reconciliations
        const reconciliations = await getdb.reconciliation.findMany({
            where: {
                status: { in: ["Short", "Excess"] },
            },
            select: {
                id: true,
                status: true,
                created_at: true,
                created_by: true,
                createdBy: { select: { full_name: true } }
            }
        });

        for (const recon of reconciliations) {
            const existing = await getdb.notification.findFirst({
                where: {
                    alert_type: "RECONCILIATION",
                    reference_id: recon.id,
                    user_id: recon.created_by
                }
            });

            if (!existing) {
                await getdb.notification.create({
                    data: {
                        user_id: recon.created_by,
                        title: "Reconciliation Alert",
                        message: `Reconciliation #${recon.id} (${recon.createdBy?.full_name || "Unknown"}) is ${recon.status}. Needs review.`,
                        alert_type: "RECONCILIATION",
                        reference_id: recon.id,
                    }
                });
            }
        }

        // 2. Fetch Pending Deals
        const pendingDeals = await getdb.deal.findMany({
            where: {
                status: "Pending",
                deleted_at: null,
            },
            select: {
                id: true,
                deal_number: true,
                created_at: true,
                created_by: true,
                createdBy: { select: { full_name: true } }
            }
        });

        for (const deal of pendingDeals) {
            const existing = await getdb.notification.findFirst({
                where: {
                    alert_type: "PENDING_DEAL",
                    reference_id: deal.id,
                    user_id: deal.created_by
                }
            });

            if (!existing) {
                await getdb.notification.create({
                    data: {
                        user_id: deal.created_by,
                        title: "Pending Deal",
                        message: `Deal #${deal.deal_number} (${deal.createdBy?.full_name || "Unknown"}) is still pending.`,
                        alert_type: "PENDING_DEAL",
                        reference_id: deal.id,
                    }
                });
            }
        }
    } catch (error) {
        logger.error("Error syncing notifications:", error);
    }
};

const getNotifications = async (userId, roleName, filter = "all") => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    let where = {
        is_deleted: false
    };

    // If not admin, only show own notifications
    if (roleName !== "Admin") {
        where.user_id = userId;
    }

    switch (filter) {
        case "new":
            where.created_at = { gte: todayStart, lte: todayEnd };
            break;
        case "read":
            where.is_read = true;
            break;
        case "unread":
            where.is_read = false;
            break;
        case "deleted":
            where.is_deleted = true;
            break;
    }

    // If filter is "deleted", we need to override the default is_deleted: false
    if (filter === "deleted") {
        where.is_deleted = true;
    }

    return await getdb.notification.findMany({
        where,
        include: {
            user: {
                select: { full_name: true }
            }
        },
        orderBy: { created_at: "desc" }
    });
};

const markAsRead = async (ids) => {
    return await getdb.notification.updateMany({
        where: { id: { in: ids.map(id => Number(id)) } },
        data: { is_read: true }
    });
};

const markAsUnread = async (ids) => {
    return await getdb.notification.updateMany({
        where: { id: { in: ids.map(id => Number(id)) } },
        data: { is_read: false }
    });
};

const deleteNotifications = async (ids) => {
    return await getdb.notification.updateMany({
        where: { id: { in: ids.map(id => Number(id)) } },
        data: { is_deleted: true }
    });
};

module.exports = {
    syncNotifications,
    getNotifications,
    markAsRead,
    markAsUnread,
    deleteNotifications
};
