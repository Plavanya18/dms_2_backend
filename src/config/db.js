const { PrismaClient } = require("@prisma/client");

const getdb = new PrismaClient();

module.exports = { getdb };