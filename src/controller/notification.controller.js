const notificationService = require("../service/notification.service");
const logger = require("../config/logger");

const getNotifications = async (req, res) => {
    try {
        const userId = req.user;
        const { filter } = req.query;

        // Auto-sync before fetching
        await notificationService.syncNotifications(userId);

        const notifications = await notificationService.getNotifications(userId, req.roleName, filter);
        return res.json({
            success: true,
            data: notifications
        });
    } catch (err) {
        logger.error("Error fetching notifications:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

const markAsRead = async (req, res) => {
    try {
        const { ids } = req.body;
        await notificationService.markAsRead(ids);
        return res.json({ success: true, message: "Notifications marked as read" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const markAsUnread = async (req, res) => {
    try {
        const { ids } = req.body;
        await notificationService.markAsUnread(ids);
        return res.json({ success: true, message: "Notifications marked as unread" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const deleteNotifications = async (req, res) => {
    try {
        const { ids } = req.body;
        await notificationService.deleteNotifications(ids);
        return res.json({ success: true, message: "Notifications deleted" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

const createNotification = async (req, res) => {
    try {
        const data = req.body;
        await notificationService.createNotification(data);
        return res.json({ success: true, message: "Notification created" });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    getNotifications,
    markAsRead,
    markAsUnread,
    deleteNotifications,
    createNotification
};
