const express = require("express");
const router = express.Router();
const userController = require("../controller/user.controller");

router.post("/", userController.createUserController);
router.get("/",  userController.listUsersController);
router.get("/me", userController.getLoggedInUserController);
router.get("/sessions", userController.getUserSessionsController);
router.get("/:id", userController.getuserIdController);
router.put("/:id", userController.updateUserController);
router.put("/status/:id",  userController.toggleUserActiveController);
router.post("/logout", userController.logoutController);
router.delete("/:id", userController.deleteUser);

module.exports = router;