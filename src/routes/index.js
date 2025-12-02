const express = require('express');
const config = require('../config/config');
const { verifyToken } = require('../middlewares/jwt.middleware');
const userRoute = require('./user.route');
const roleRoute = require('./role.route');
const authRoutes = require('./auth.route');
const ipRoute = require('./ipaddress.route');
const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoutes,
  },
  {
    path: '/user',
    route: userRoute
  },
  {
    path: '/role',
    route: roleRoute
  },
  {
    path: '/ipaddress',
    route: ipRoute
  }
];

const publicPaths = [
  '/auth/login',
  '/auth/verify-otp',
  '/auth/change-password',
  '/auth/request-password-reset',
  '/auth/reset-password',
];

router.use((req, res, next) => {
  const path = req.baseUrl + req.path;

  if (publicPaths.includes(path)) {
    return next();
  }

  return verifyToken(req, res, next);
});

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

module.exports = router;
