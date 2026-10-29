const fs = require('fs');
const path = require('path');
const winston = require('winston');

const isProd = process.env.NODE_ENV === 'production';
// Prefer console in containers (docker logs / journald). Optional file logs when LOG_TO_FILE=1.
const transports = [new winston.transports.Console()];

if (isProd && process.env.LOG_TO_FILE === '1') {
  const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  try {
    fs.mkdirSync(logDir, { recursive: true });
    transports.push(new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }));
    transports.push(new winston.transports.File({ filename: path.join(logDir, 'combined.log') }));
  } catch (err) {
    // Console still works — do not crash on log dir issues.
  }
}

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    isProd
      ? winston.format.json()
      : winston.format.combine(winston.format.colorize(), winston.format.simple())
  ),
  transports,
});

module.exports = { logger };
