const msgTrace = require("debug")("gclib:msg");
const debug = require("debug")("gclib:debug");
const debugSocket = require("debug")("gclib:debug:socket");
const info = require("debug")("gclib:info");
const warn = require("debug")("gclib:warn");
const error = require("debug")("gclib:error");

module.exports = {
  msgTrace,
  debug,
  debugSocket,
  info,
  warn,
  error
};
