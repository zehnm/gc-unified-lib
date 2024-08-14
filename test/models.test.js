const test = require("ava");
const {
  productFamilyFromVersion,
  modelFromVersion,
  ProductFamily,
  parseDevices,
  parseIrPort,
  checkErrorResponse,
  expectedResponse
} = require("../src/models");

const getProductFamily = test.macro((t, input, expected) => {
  const family = productFamilyFromVersion(input);
  t.is(family, expected);
});

test("productFamilyFromVersion with minimal GC-100 version", getProductFamily, "version,", ProductFamily.GC100);
test("productFamilyFromVersion with full GC-100 version", getProductFamily, "version,3.0-12", ProductFamily.GC100);
test(
  "productFamilyFromVersion with full GC-100 version and linefeed",
  getProductFamily,
  "version,3.2-12\r",
  ProductFamily.GC100
);

test("productFamilyFromVersion with minimal iTach version", getProductFamily, "710-1", ProductFamily.ITACH);
test("productFamilyFromVersion with full iTach version", getProductFamily, "710-1005-05", ProductFamily.ITACH);
test(
  "productFamilyFromVersion with full iTach version and linefeed",
  getProductFamily,
  "710-1010-xx\r",
  ProductFamily.ITACH
);

test("productFamilyFromVersion with minimal Flex WF version", getProductFamily, "710-2", ProductFamily.FLEX);
test("productFamilyFromVersion with minimal Flex IP version", getProductFamily, "710-3", ProductFamily.FLEX);
test("productFamilyFromVersion with full Flex version", getProductFamily, "710-2000-WF", ProductFamily.FLEX);
test(
  "productFamilyFromVersion with full Flex WF version and linefeed",
  getProductFamily,
  "710-2000-WF\r",
  ProductFamily.FLEX
);
test(
  "productFamilyFromVersion with full Flex IP version and linefeed",
  getProductFamily,
  "710-3000-IP\r",
  ProductFamily.FLEX
);

test(
  "productFamilyFromVersion with minimal Global Connect version",
  getProductFamily,
  "710-4",
  ProductFamily.GLOBAL_CONNECT
);
test(
  "productFamilyFromVersion with full Global Connect version",
  getProductFamily,
  "710-4001-IR",
  ProductFamily.GLOBAL_CONNECT
);
test(
  "productFamilyFromVersion with full Global Connect version and linefeed",
  getProductFamily,
  "710-4001-IR\r",
  ProductFamily.GLOBAL_CONNECT
);

test("productFamilyFromVersion with empty version input returns unknown", getProductFamily, "", ProductFamily.UNKNOWN);
test(
  "productFamilyFromVersion with unknown version input returns unknown",
  getProductFamily,
  "foobar",
  ProductFamily.UNKNOWN
);

const getModel = test.macro((t, input, expected) => {
  const model = modelFromVersion(input);
  t.is(model, expected);
});

test("modelFromVersion with empty version input returns empty model", getModel, "", "");
test("modelFromVersion with unknown version input returns empty model", getModel, "foobar", "");

const getDevices = test.macro((t, input, expected) => {
  const modules = parseDevices(input);
  t.is(JSON.stringify(modules), JSON.stringify(expected));
});

test("parseDevices with empty devices input returns empty array", getDevices, "", []);
test(
  "parseDevices returns all devices",
  getDevices,
  "device,1,1 SERIAL\rdevice,2,1 SERIAL\rdevice,3,3 RELAY\rdevice,4,3 IR\rdevice,5,3 IR\rendlistdevices\r",
  [
    {
      module: 1,
      port: 1,
      portType: "SERIAL"
    },
    {
      module: 2,
      port: 1,
      portType: "SERIAL"
    },
    {
      module: 3,
      port: 1,
      portType: "RELAY"
    },
    {
      module: 3,
      port: 2,
      portType: "RELAY"
    },
    {
      module: 3,
      port: 3,
      portType: "RELAY"
    },
    {
      module: 4,
      port: 1,
      portType: "IR"
    },
    {
      module: 4,
      port: 2,
      portType: "IR"
    },
    {
      module: 4,
      port: 3,
      portType: "IR"
    },
    {
      module: 5,
      port: 1,
      portType: "IR"
    },
    {
      module: 5,
      port: 2,
      portType: "IR"
    },
    {
      module: 5,
      port: 3,
      portType: "IR"
    }
  ]
);

const getIrPort = test.macro((t, input, expected) => {
  const modules = parseIrPort(input);
  t.is(JSON.stringify(modules), JSON.stringify(expected));
});

test("parseIrPort with empty input returns null", getIrPort, "", null);
test("parseIrPort with invalid input returns null", getIrPort, "foobar", null);
test("parseIrPort with invalid input format returns null", getIrPort, "IR 1:2 SENSOR", null);
test("parseIrPort with missing mode returns null", getIrPort, "IR,1:2", null);
test("parseIrPort with invalid module returns null", getIrPort, "IR,a:2,SERIAL", null);
test("parseIrPort with invalid port returns null", getIrPort, "IR,1:b,SERIAL", null);
test("parseIrPort returns all fields", getIrPort, "IR,1:2,BL2_BLASTER", { module: 1, port: 2, mode: "BL2_BLASTER" });

test("normal response is not an error", (t) => {
  const response = "NET,0:1,UNLOCKED,DHCP,192.168.0.100,255.255.255.0,192.168.0.1\r";
  const responseEndIndex = response.lastIndexOf("\r");

  try {
    checkErrorResponse(response, responseEndIndex);
    t.pass();
  } catch (e) {
    t.fail(`No error expected, got: ${e}`);
  }
});

const detectError = test.macro((t, input, expected) => {
  const responseEndIndex = input.lastIndexOf("\r");

  try {
    checkErrorResponse(input, responseEndIndex);
    t.fail("Error response not detected");
  } catch (e) {
    t.is(e.message, expected.msg);
    t.is(e.code, expected.code);
  }
});

test("detect GC-100 error", detectError, "unknowncommand 3\r", {
  msg: "Invalid module address (module does not exist).",
  code: "3"
});
test("detect iTach error", detectError, "ERR_1:1,014\r", {
  msg: "Blaster command sent to non-blaster connector.",
  code: "014"
});
test("detect Flex error", detectError, "ERR SL001\r", { msg: "Invalid baud rate.", code: "SL001" });
test("detect Global Connect error", detectError, "ERR RO002\r", { msg: "Invalid logical relay state.", code: "RO002" });

test("detect undefined GC-100 error", detectError, "unknowncommand 99\r", {
  msg: "unknowncommand 99",
  code: "99"
});
test("detect undefined iTach error", detectError, "ERR_1:1,042\r", { msg: "ERR_1:1,042", code: "042" });
test("detect undefined Flex error", detectError, "ERR SL009\r", { msg: "ERR SL009", code: "SL009" });
test("detect undefined Global Connect error", detectError, "ERR foobar\r", { msg: "ERR foobar", code: "foobar" });

const getExpectedResponse = test.macro((t, input, expected) => {
  const result = expectedResponse(input);
  t.is(result, expected);
});

test("expectedResponse returns undefined for unknown request", getExpectedResponse, "foobar", undefined);
test(
  "expectedResponse doesn't return module:port for non-connector requests",
  getExpectedResponse,
  "getdevices",
  "device"
);
test(
  "expectedResponse returns module:port,ID for sendir",
  getExpectedResponse,
  "sendir,1:1,123,40000,1,1,96,24,48,24,24,24,48,24,24,24,48,24,24,24,24,24,48,24,24,24,24,24,24,24,24,1035",
  "completeir,1:1,123"
);
test("expectedResponse returns module:port for stopir", getExpectedResponse, "stopir,1:1", "stopir,1:1");
test("expectedResponse returns module:port for get_NET", getExpectedResponse, "get_NET,0:1", "NET,0:1");
test(
  "expectedResponse returns module:port for set_NET",
  getExpectedResponse,
  "set_NET,0:1,UNLOCKED,STATIC,192.168.0.50,255.255.255.0,192.168.0.1",
  "NET,0:1"
);
test("expectedResponse returns module:port for get_IR", getExpectedResponse, "get_IR,1:2", "IR,1:2");
test("expectedResponse returns module:port for set_IR", getExpectedResponse, "set_IR,1:2,RECEIVER", "IR,1:2");
test("expectedResponse returns module:port for get_SERIAL", getExpectedResponse, "get_SERIAL,1:1", "SERIAL,1:1");
test(
  "expectedResponse returns module:port for set_SERIAL",
  getExpectedResponse,
  "set_SERIAL,1:1,38400,FLOW_HARDWARE,PARITY_EVEN",
  "SERIAL,1:1"
);
test("expectedResponse returns module:port for get_RELAY", getExpectedResponse, "get_RELAY,1:1", "RELAY,1:1");
test("expectedResponse returns module:port for set_RELAY", getExpectedResponse, "set_RELAY,1:1,Disabled", "RELAY,1:1");
test("expectedResponse returns module:port for getstate", getExpectedResponse, "getstate,1:1", "state,1:1");
test("expectedResponse returns module:port for setstate", getExpectedResponse, "setstate,3:2,0", "state,3:2");
test(
  "expectedResponse returns module:port for getstate with carriage return",
  getExpectedResponse,
  "getstate,1:1\r",
  "state,1:1"
);

test("expectedResponse returns version for getversion", getExpectedResponse, "getversion\r", "version");
