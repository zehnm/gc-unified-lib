const test = require("ava");
const {
  productFamilyFromVersion,
  modelFromVersion,
  ProductFamily,
  parseDevices,
  parseIrPort
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
