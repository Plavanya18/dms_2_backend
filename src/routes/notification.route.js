const express = require("express");
const router = express.Router();
const notificationController = require("../controller/notification.controller");
const auth = require("../middleware/auth");

router.get("/", auth, notificationController.getNotifications);
router.post("/mark-read", auth, notificationController.markAsRead);
router.post("/mark-unread", auth, notificationController.markAsUnread);
router.post("/delete", auth, notificationController.deleteNotifications);

module.exports = router;
