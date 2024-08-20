const debugModule = require("debug");

const log = {
  msgTrace: debugModule("gclib:msg"),
  debug: debugModule("gclib:debug"),
  debugSocket: debugModule("gclib:debug:socket"),
  info: debugModule("gclib:info"),
  warn: debugModule("gclib:warn"),
  error: debugModule("gclib:error")
};

module.exports = log;
