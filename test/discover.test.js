const test = require("ava");
const { splitBeacon } = require("../src/discover");

const testSplitBeacon = test.macro((t, input, expected) => {
  const result = splitBeacon(input);
  t.deepEqual(result, expected);
});

test(
  "beacon not starting with AMXB returns null",
  testSplitBeacon,
  "AMXC<-UUID=GlobalCache_000C1E024239><-SDKClass=Utility><-Make=GlobalCache><-Model=iTachWF2IR><-Revision=710-1001-05><-Pkg_Level=GCPK001><-Config-URL=http://192.168.1.100.><-PCB_PN=025-0026-06><-Status=Ready>",
  null
);

test("invalid beacon string returns empty map", testSplitBeacon, "AMXB hello world", new Map());
test("invalid beacon format returns empty map", testSplitBeacon, "AMXB<>", new Map());
test("invalid beacon elements returns empty map", testSplitBeacon, "AMXB<hello><world><foo!=bar>", new Map());

test(
  "valid beacon elements are returned, invalid filtered out",
  testSplitBeacon,
  "AMXB<hello><world><-foo=bar>",
  new Map([["foo", "bar"]])
);

test(
  "beacon parsing returns all elements",
  testSplitBeacon,
  "AMXB<-UUID=GlobalCache_000C1E024239><-SDKClass=Utility><-Make=GlobalCache><-Model=iTachWF2IR><-Revision=710-1001-05><-Pkg_Level=GCPK001><-Config-URL=http://192.168.1.100.><-PCB_PN=025-0026-06><-Status=Ready>",
  new Map([
    ["UUID", "GlobalCache_000C1E024239"],
    ["SDKClass", "Utility"],
    ["Make", "GlobalCache"],
    ["Model", "iTachWF2IR"],
    ["Revision", "710-1001-05"],
    ["Pkg_Level", "GCPK001"],
    ["Config-URL", "http://192.168.1.100."],
    ["PCB_PN", "025-0026-06"],
    ["Status", "Ready"]
  ])
);
