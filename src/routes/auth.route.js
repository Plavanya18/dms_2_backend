const express = require("express");
const router = express.Router();
const authController = require("../controller/auth.controller");

router.post("/login", authController.loginController);
router.post("/verify-otp", authController.verifyOtpController);
router.put("/change-password", authController.changePasswordController);
router.post("/request-password-reset", authController.requestPasswordResetController);
router.post("/reset-password", authController.resetPasswordController);

module.exports = router;