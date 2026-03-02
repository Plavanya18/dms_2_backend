const express = require('express');
const config = require('../config/config');
const { verifyToken } = require('../middlewares/jwt.middleware');
const userRoute = require('./user.route');
const authRoutes = require('./auth.route');
const currencyRoute = require('./currency.route');
const dealRoute = require('./deal.route');
const reconciliationRoute = require('./reconciliation.route');
const customerRoute = require('./customer.route');
const pnlRoute = require('./pnl.route');
const expenseRoute = require('./expense.route');
const currencyPairRoute = require('./currencyPair.route');
const openSetRateRoute = require('./openSetRate.route');
const notificationRoute = require('./notification.route');
const router = express.Router();

const defaultRoutes = [
  {
    path: '/api/auth',
    route: authRoutes,
  },
  {
    path: '/api/user',
    route: userRoute
  },
  {
    path: '/api/currency',
    route: currencyRoute
  },
  {
    path: '/api/deal',
    route: dealRoute
  },
  {
    path: '/api/reconciliation',
    route: reconciliationRoute
  },
  {
    path: '/api/customer',
    route: customerRoute
  },
  {
    path: '/currencypair',
    route: currencyPairRoute,
  },
  {
    path: '/api/open-set-rate',
    route: openSetRateRoute,
  },
  {
    path: '/api/pnl',
    route: pnlRoute
  },
  {
    path: '/api/expense',
    route: expenseRoute
  },
  {
    path: '/api/notifications',
    route: notificationRoute
  }
];

const publicPaths = [
  '/api/auth/login',
  '/api/auth/verify-otp',
  '/api/auth/change-password',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
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
