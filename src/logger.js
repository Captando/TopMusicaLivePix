function ts() {
  return new Date().toISOString();
}

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(`[${ts()}]`, ...args);
}

function warn(...args) {
  // eslint-disable-next-line no-console
  console.warn(`[${ts()}]`, ...args);
}

function error(...args) {
  // eslint-disable-next-line no-console
  console.error(`[${ts()}]`, ...args);
}

module.exports = { log, warn, error };

