const app = require('./app');
const dotenv = require('dotenv');
const logger = require('./config/logger');
dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Listening to port for ${PORT}`);
});
