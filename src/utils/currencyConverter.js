const { getdb } = require("../config/db");

const buildCurrencyMaps = async () => {
  const currencies = await getdb.currency.findMany();

  const idToCode = {};
  const codeToId = {};

  for (const c of currencies) {
    idToCode[c.id] = c.code;
    codeToId[c.code] = c.id;
  }

  return { idToCode, codeToId };
};

const getLastInrRateForCurrency = async (currencyId) => {
  const inr = await getdb.currency.findFirst({ where: { code: "INR" } });
  if (currencyId === inr.id) return 1;

  const deal = await getdb.deal.findFirst({
    where: {
      OR: [
        {
          received_items: {
            some: { currency_id: currencyId },
          },
          paid_items: {
            some: { currency_id: inr.id },
          },
        },
        {
          received_items: {
            some: { currency_id: inr.id },
          },
          paid_items: {
            some: { currency_id: currencyId },
          },
        },
      ],
    },
    orderBy: { created_at: "desc" },
    include: {
      received_items: true,
      paid_items: true,
    },
  });

  if (!deal) return null;

  const received = deal.received_items[0];
  const paid = deal.paid_items[0];

  if (received.currency_id === currencyId) {
    return Number(deal.rate);
  }

  return 1 / Number(deal.rate);
};

const convertDealToUSD = async (deal) => {
  const received = deal.received_items[0];
  const paid = deal.paid_items[0];

  if (!received || !paid) return 0;

  const buyCurrencyId = received.currency_id;
  const sellCurrencyId = paid.currency_id;

  let amountInINR = 0;

  const sellInrRate = await getLastInrRateForCurrency(sellCurrencyId);
  if (!sellInrRate) return 0;

  amountInINR = Number(deal.amount_to_be_paid) * sellInrRate;

  const usd = await getdb.currency.findFirst({ where: { code: "USD" } });
  const usdInrRate = await getLastInrRateForCurrency(usd.id);

  if (!usdInrRate) return 0;

  return amountInINR / usdInrRate;
};

module.exports = {
    buildCurrencyMaps,
    getLastInrRateForCurrency,
    convertDealToUSD
}