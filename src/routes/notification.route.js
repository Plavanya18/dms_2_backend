const express = require("express");
const router = express.Router();
const notificationController = require("../controller/notification.controller");

router.get("/", notificationController.getNotifications);
router.post("/mark-read", notificationController.markAsRead);
router.post("/mark-unread", notificationController.markAsUnread);
router.post("/delete", notificationController.deleteNotifications);

module.exports = router;
