// const app = require('./app');
// const dotenv = require('dotenv');
// const logger = require('./config/logger');
// dotenv.config();

// const PORT = process.env.PORT || 3000;

// app.listen(PORT, () => {
//   logger.info(`Listening to port for ${PORT}`);
// });
const dotenv = require('dotenv');
dotenv.config(); // LOAD ENV FIRST

const app = require('./app');
const logger = require('./config/logger');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Listening to port for ${PORT}`);
});