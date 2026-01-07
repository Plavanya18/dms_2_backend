const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const routes = require('./routes');

const app = express();

// set security HTTP headers
app.use(helmet());

// parse json request body
app.use(express.json());

// parse urlencoded request body
app.use(express.urlencoded({ extended: true }));

// gzip compression
app.use(compression());

// enable cors
app.use(cors());

app.use('/', routes); 
// simple test route
app.get('/', (req, res) => {
  res.send({ message: 'Deal Management Backend is running 🚀' });
});

module.exports = app;
