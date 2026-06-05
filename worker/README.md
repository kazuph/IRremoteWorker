# IRremoteESP8266 Cloudflare Worker

This Worker exposes IRremoteESP8266 through a Hono JSON API on Cloudflare
Workers. The IR logic is not a TypeScript reimplementation: `worker/native`
builds the original C++ library with Emscripten and the API calls that WASM
module.

## Supported Surface

- `POST /api/infer`: calls the original `IRrecv::decode()` against raw timings
  and, for supported A/C messages, returns common state fields from
  `IRAcUtils::decodeToState()` plus the original
  `IRAcUtils::resultAcToString()` description.
- `POST /api/generate`: calls original C++ generation paths:
  - `kind: "raw"` -> `IRsend::sendRaw()`
  - `kind: "value"` -> `IRsend::send(decode_type_t, uint64_t, bits, repeat)`
  - `kind: "state"` -> `IRsend::send(decode_type_t, uint8_t *state, nbytes)`
  - `kind: "method"` -> public `IRsend` helper methods by C++ method name,
    with args in the same order as the upstream signature
  - `kind: "encode"` -> public `IRsend` encoder/toggle helpers
  - `kind: "class"` -> generated protocol-class raw state/value bridge that
    calls original C++ `setRaw()`, `send()`, and `getRaw()` for classes where
    that trio is implemented in upstream; the same kind also exposes generated
    native-backed scalar instance `set*`/`get*` methods by C++ method name
  - `kind: "classStatic"` -> generated native-backed scalar static protocol
    class helpers, including `toCommon*` enum/integer conversion helpers
  - `kind: "classCommon"` -> generated native-backed protocol class
    `toCommon()` conversion for raw-bridge classes that return `stdAc::state_t`
  - `kind: "classString"` -> generated native-backed protocol class
    `toString()` conversion for raw-bridge classes that expose `String
    toString()`
  - `kind: "classFromCommon"` -> generated native-backed protocol class
    `fromCommon(stdAc::state_t)` conversion where upstream exposes it
  - `kind: "ac"` -> `IRac::sendAc()`
- `GET /api/protocols`: returns the enabled protocol ids and metadata from C++.
- `GET /api/class-surface`: returns the checked-in protocol class
  setter/getter inventory generated from `src/ir_*.h`, including class names,
  method kind, return type, parameters, `const`/`static` flags, and original C++
  signatures. This is an inventory for future native-backed class schema work,
  not full class-method generation support.
- `GET /api/class-raw-surface`: returns the checked-in protocol class raw bridge
  inventory generated from `src/ir_*.h`.
- `GET /api/class-method-surface`: returns the checked-in protocol class method
  bridge inventory for native-backed `set*`/`get*` calls.
- `GET /api/class-static-surface`: returns the checked-in scalar protocol class
  static conversion bridge inventory for native-backed `toCommon*` and related
  static helpers.
- `GET /api/class-common-surface`: returns the checked-in protocol class
  `toCommon()` bridge inventory for native-backed common A/C state conversion.
- `GET /api/class-string-surface`: returns the checked-in protocol class
  `toString()` bridge inventory for native-backed human-readable protocol state
  conversion.
- `GET /api/class-from-common-surface`: returns the checked-in protocol class
  `fromCommon()` bridge inventory for native-backed reverse common A/C state
  conversion.
- `GET /api/latest`: returns the most recent infer/generate event from the D1
  event log when the Worker binding is available.
- `GET /`: StackChan-style live remote dashboard. It mirrors the latest
  inferred manufacturer/protocol, A/C mode, temperature, fan, and swing values,
  keeps a local detected-device list, can generate the currently displayed A/C
  state through `/api/generate`, and preserves the raw JSON log view for
  debugging.

The current build includes all `src/ir_*.cpp` files with `_IR_ENABLE_DEFAULT_=1`.
The native protocol inventory currently reports 128 ids: 70 value-style
protocols, 58 state-style protocols, and 66 protocols accepted by the common
A/C API.
Both `npm run native:build` and `npm run native:oracle:build` compile through
`worker/native/ir_full.cpp`; there is no reduced bridge in the Worker build.

## Examples

```sh
npm run db:migrate:local
npm run dev
```

```sh
curl -s http://localhost:8787/api/protocols
```

```sh
curl -s http://localhost:8787/api/generate \
  -H 'content-type: application/json' \
  -d '{"kind":"ac","protocol":"DAIKIN","model":-1,"power":true,"mode":"cool","degrees":25,"celsius":true,"fan":"medium","swingv":0,"swingh":0,"quiet":true,"turbo":false,"econo":true,"light":true,"filter":false,"clean":false,"beep":true,"sleep":-1,"clock":-1}'
```

```sh
curl -s http://localhost:8787/api/generate \
  -H 'content-type: application/json' \
  -d '{"kind":"value","protocol":"NEC","data":"0x20DF10EF","bits":32,"repeat":0}'
```

```sh
curl -s http://localhost:8787/api/generate \
  -H 'content-type: application/json' \
  -d '{"kind":"raw","raw":[9000,4500,560,560,560,1690],"frequency":38000}'
```

```sh
curl -s http://localhost:8787/api/generate \
  -H 'content-type: application/json' \
  -d '{"kind":"method","method":"sendPanasonic","args":[16388,16825341,48,0]}'
```

```sh
curl -s http://localhost:8787/api/generate \
  -H 'content-type: application/json' \
  -d '{"kind":"encode","method":"encodeNEC","args":[32,239]}'
```

```sh
curl -s http://localhost:8787/api/infer \
  -H 'content-type: application/json' \
  -d '{"raw":[9000,4500,560,560,560,1690],"frequency":38000}'
```

A/C inference responses include top-level `manufacturer`, `model`, and
`modelName` fields only when the native library can convert the decode to a
common A/C state, plus an `ac` object with `power`, `mode`, `degrees`, `fan`,
`swingv`, `swingh`, and other common A/C state fields from the original C++
library. `manufacturer` is a display helper mechanically derived from the
native common-state protocol id, not an independent TypeScript protocol
classifier. Non-A/C matches keep `manufacturer`, `model`, `modelName`, and
`ac` as `null`.
Matched inference responses include both JavaScript-style and native-style
aliases for key decode fields: `decodeType`/`decode_type`,
`valueHex`/`value_hex`, and `rawLength`/`raw_length`.

## Verification

```sh
npm run build
npm run class:surface
npm run class:surface:write
npm test
npm run verify:local
npm run deploy:dry-run
npm run deploy
npm run verify:prod
```

`npm test` rebuilds the C++ WASM bundle, builds a native C++ oracle from the
same bridge, then compares protocol listing, value generation, state generation,
raw generation, public helper method generation, encoder helper output,
full common A/C API generation, and decode inference output for generated
value-style, state-style, and direct `IRsend` method raw timings. It also parses
`src/IRsend.h` to check
that public direct value/state `IRsend::send*` helpers and public
`encode*`/`toggle*` helpers are exposed by the bridge and covered by oracle
comparisons. Current tests assert 132 public `IRsend::send*` names, 19 public
`encode*`/`toggle*` names, and zero untested exposed helper names. It also runs
185 numeric upstream `test/ir_*_test.cpp` raw decode fixtures through both WASM
and the native oracle. `ir_Arris_test.cpp:rawData_1` is skipped because it is
not a pure numeric initializer. The common A/C API test walks every protocol reported by
`IRac::isProtocolSupported()`: 65 protocols currently produce matching native
raw timings with default common settings, while `YORK` is recorded as the
native `IRac::sendAc()` error case because it is listed as supported but has no
send switch case in the upstream common A/C sender. This is
intentionally oracle-based so a regression in the Worker bridge is caught as a
difference from the native C++ library.
The protocol class method tests compare every raw-value class method and every
byte-state class method against the native oracle: 326 raw-value methods and
1058 byte-state methods currently run through the same generated bridge. The
byte-state method test starts from the original C++ class default state when no
`state` is supplied, so default-state A/C setter/getter behavior is covered
without a hand-written TypeScript state model.
The protocol class raw generation tests also walk every byte-array raw class:
50 byte-state classes currently generate raw timings from the original C++
default state with no supplied `state`, and the WASM output is compared against
the native C++ oracle.
The protocol class common/string tests also compare default-state byte-array
classes against the native oracle: 49 byte-state `toCommon()` conversions and
49 byte-state `toString()` conversions currently run with no supplied `state`.

The HTTP API tests also assert that `/` serves the StackChan-style remote
dashboard with the raw log view, verify `/api/class-surface` against the
header-derived inventory, then compare `/api/protocols`, `/api/generate`, and
`/api/infer` responses against the native oracle. They explicitly check the
native decode contract fields `decode_type`, `bits`, `value`, `state`,
`address`, `command`, `repeat`, and `rawlen`, plus the HTTP/API aliases
`decodeType`, `valueHex`/`value_hex`, and `rawLength`/`raw_length`, for
value-style, stateful, non-A/C, and upstream fixture decode examples.
Unsupported generation or inference input returns an explicit JSON error with
HTTP 400, for example `{"error":"unsupported IRsend method"}`,
`{"error":"unsupported generation kind: pretend"}`, or
`{"error":"raw must be an array of pulse durations"}`.

`npm run verify:local` starts `wrangler dev --local`, then compares the local
HTTP Worker endpoint against the native oracle for protocol inventory, value
generation, state generation, protocol class raw-state generation, raw
generation, generated raw inference for value/state output, Panasonic A/C common
state fields, an upstream ClimaButler decode fixture, unsupported method error
handling, unsupported generation kind error handling, invalid inference input
error handling, protocol class common-state conversion, and unsupported protocol
class setter/getter error handling.
`npm run verify:prod`
performs the same native-oracle comparison against the deployed Worker endpoint.
`npm run --silent class:surface` prints the typed JSON inventory used to count
and design the protocol class setter/getter surface. It should be used as the
source of truth for future native-backed class method schema generation.
`npm run class:surface:write` writes the same inventory to
`worker/generated/protocol-class-surface.json`; `npm test` checks that the
checked-in manifest still matches the headers.
`npm run --silent class:raw-surface` prints the generated raw-state class bridge
inventory. `npm run class:raw-surface:write` refreshes
`worker/generated/protocol-class-raw-surface.json` and
`worker/native/generated_class_raw_bridge.h`.
`npm run --silent class:method-surface` prints the generated method bridge
inventory. `npm run class:method-surface:write` refreshes
`worker/generated/protocol-class-method-surface.json` and
`worker/native/generated_class_method_bridge.h`.
`npm run --silent class:static-surface` prints the generated scalar static
conversion bridge inventory. `npm run class:static-surface:write` refreshes
`worker/generated/protocol-class-static-surface.json` and
`worker/native/generated_class_static_bridge.h`.
`npm run --silent class:common-surface` prints the generated `toCommon()` bridge
inventory. `npm run class:common-surface:write` refreshes
`worker/generated/protocol-class-common-surface.json` and
`worker/native/generated_class_common_bridge.h`.
`npm run --silent class:string-surface` prints the generated `toString()`
bridge inventory. `npm run class:string-surface:write` refreshes
`worker/generated/protocol-class-string-surface.json` and
`worker/native/generated_class_string_bridge.h`.
`npm run --silent class:from-common-surface` prints the generated `fromCommon()`
bridge inventory. `npm run class:from-common-surface:write` refreshes
`worker/generated/protocol-class-from-common-surface.json` and
`worker/native/generated_class_from_common_bridge.h`.

## Known Limits

This Worker now exposes the generic original C++ generation paths plus these
public helper methods: `sendData`, `sendManchesterData`, `sendManchester`,
`sendGeneric`, `sendGenericMesgtime`, `sendGenericBytes`, `sendGC`,
`sendPronto`, `sendSharp`, `sendPanasonic`, plus direct value-style
`IRsend` methods with `[data, nbits, repeat]` args: `sendNEC`, `sendSony`,
`sendSony38`, `sendSherwood`, `sendSAMSUNG`, `sendSamsung36`, `sendLG`,
`sendLG2`, `sendSharpRaw`, `sendJVC`, `sendDenon`, `sendSanyoLC7461`,
`sendDISH`, `sendPanasonic64`, `sendRC5`, `sendRC6`, `sendRCMM`,
`sendCOOLIX`, `sendCoolix48`, `sendWhynter`, `sendMitsubishi`,
`sendMitsubishi2`, `sendInax`, `sendDaikin64`, `sendAiwaRCT501`,
`sendGree`, `sendGoodweather`, `sendGorenje`, `sendNikai`, `sendMidea`,
`sendMidea24`, `sendMagiQuest`, `sendLasertag`, `sendCarrierAC`,
`sendCarrierAC40`, `sendCarrierAC64`, `sendGICable`, `sendLutron`,
`sendPanasonicAC32`, `sendPioneer`, `sendVestelAc`, `sendTeco`,
`sendLegoPf`, `sendEpson`, `sendSymphony`, `sendAirwell`,
`sendDelonghiAc`, `sendDoshisha`, `sendMultibrackets`, `sendTechnibelAc`,
`sendZepeal`, `sendMetz`, `sendTranscold`, `sendElitescreens`,
`sendMilestag2`, `sendEcoclim`, `sendXmp`, `sendTruma`, `sendKelon`,
`sendBose`, `sendArris`, `sendAirton`, `sendToto`, `sendClimaButler`, and
`sendWowwee`.

It also exposes direct state-array `IRsend` methods with
`[nbytes, repeat, ...stateBytes]` args: `sendMirage`, `sendMitsubishi136`,
`sendMitsubishi112`, `sendMitsubishiAC`, `sendMitsubishiHeavy88`,
`sendMitsubishiHeavy152`, `sendFujitsuAC`, `sendKelvinator`,
`sendSamsungAC`, `sendSharpAc`, `sendSanyoAc`, `sendSanyoAc88`,
`sendSanyoAc152`, `sendDaikin`, `sendDaikin128`, `sendDaikin152`,
`sendDaikin160`, `sendDaikin176`, `sendDaikin2`, `sendDaikin200`,
`sendDaikin216`, `sendDaikin312`, `sendGree`, `sendArgoWREM3`,
`sendTrotec`, `sendTrotec3550`,
`sendToshibaAC`, `sendCarrierAC84`, `sendCarrierAC128`, `sendHaierAC`,
`sendHaierACYRW02`, `sendHaierAC160`, `sendHaierAC176`, `sendHitachiAC`,
`sendHitachiAC1`, `sendHitachiAC2`, `sendHitachiAc3`, `sendHitachiAc264`,
`sendHitachiAc296`, `sendHitachiAc344`, `sendHitachiAc424`,
`sendWhirlpoolAC`, `sendElectraAC`, `sendPanasonicAC`, `sendMWM`,
`sendTcl96Ac`, `sendTcl112Ac`, `sendNeoclima`, `sendAmcor`,
`sendCoronaAc`, `sendVoltas`, `sendTeknopoint`, `sendKelon168`,
`sendRhoss`, `sendBosch144`, `sendYork`, `sendBluestarHeavy`, and
`sendEurom`. `sendArgo` uses `[nbytes, repeat, sendFooter, ...stateBytes]`.
The class-only send helpers not listed in `IRsend.h` are also exposed:
`sendArgoSensorTemp`, `sendArgoWrem3SensorTemp`, `sendSamsungAcExtended`,
`sendSamsungAcOn`, and `sendSamsungAcOff`.

For public `IRsend` helper methods with trailing C++ default arguments, the
`method` API accepts the same trailing omissions. Value-style helpers accept
`[data]`, `[data, nbits]`, or `[data, nbits, repeat]`; state-array helpers with
default `nbytes` accept `state: [...]`; `sendSharp` and `sendPanasonic` accept
2 to 4 args; `sendData` accepts 6 or 7; `sendManchesterData` accepts 3 to 5;
and `sendManchester` accepts 7 to 12.

It also exposes these public encoder/toggle helpers: `encodeNEC`, `encodeSony`,
`encodeSAMSUNG`, `encodeLG`, `encodeSharp`, `encodeJVC`,
`encodeSanyoLC7461`, `encodePanasonic`, `encodeRC5`, `encodeRC5X`,
`toggleRC5`, `encodeRC6`, `toggleRC6`, `encodeMagiQuest`, `encodePioneer`,
`encodeDoshisha`, `encodeMetz`, `toggleArrisRelease`, and `encodeArris`.
Encoder helpers also accept trailing C++ default arguments where the original
method defines them.

Protocol-specific `IRsend::send*` convenience overloads use the
`kind: "method"` schema with the C++ method name and ordered `args`; the
class-only send helpers above are also exposed there.

The generated protocol-class raw bridge exposes 67 upstream classes where the
headers and implementation provide a public pin constructor, `setRaw()`, a
linkable class `send(repeat)` or matching original `IRsend::send*()` helper, and
`getRaw()`. Use `kind: "class"` with either `state: [...]` for byte-array
classes, no `state` to send from the original C++ class default byte state, or
`data: "0x..."` for `uint32_t`/`uint64_t` raw-value classes. The native bridge
calls the original C++ protocol class or original C++ `IRsend` helper directly
and returns the post-`getRaw()` state/value plus captured timings. The method
bridge also exposes 1384 generated instance `set*`/`get*`
methods from those classes via
`kind: "class"` with `method` and ordered `args`. These calls instantiate the
original C++ class, apply the supplied raw state/value through `setRaw()`, call
the original C++ setter/getter method, and return the method result plus the
post-call `getRaw()` state/value. For byte-array classes, omitting `state` keeps
the original C++ constructor's default state and returns the corresponding
`getRaw()` bytes using a state length mechanically derived from upstream C++
declarations/implementations.
The static conversion bridge exposes 149 scalar static class helpers through
`kind: "classStatic"`, including native-backed `toCommon*` conversions and
static helpers that consume `state` byte arrays and return the underlying
enum/integer result. Raw-struct reference helpers with a `raw[]` backing field,
such as `IRArgoAC_WREM3::getMessageType(const ArgoProtocolWREM3&)`, are called
by mechanically copying supplied `state` bytes into the original C++ raw union.
The common-state bridge exposes 66 upstream protocol class `toCommon()` methods
through `kind: "classCommon"`. It instantiates the original C++ class, applies
the supplied raw state/value with `setRaw()` when present, otherwise keeps the
original byte-array class default state, calls the original `toCommon()`, and
returns the common A/C state object plus the post-call raw state/value.
The string bridge exposes 66 upstream protocol class `toString()` methods
through `kind: "classString"`. It instantiates the original C++ class, applies
the supplied raw state/value with `setRaw()` when present, otherwise keeps the
original byte-array class default state, calls the original `toString()`, and
returns the C++ `String` result plus the post-call raw state/value.
The reverse common-state bridge exposes the upstream `IRMirageAc::fromCommon()`
method through `kind: "classFromCommon"`. It builds a `stdAc::state_t` from the
request, calls the original C++ `fromCommon()`, calls the original `send()`, and
returns raw timings, the post-call raw state, and the round-tripped common state.

The Worker still does not expose stateful protocol class setter/getter APIs as
REST object schemas. The `worker/test/protocol-class-surface.mjs` inventory
evaluates the same compile-time header gates as the current WASM/native oracle
build and finds 42 `src/ir_*.h` headers with 68 protocol classes and 1762 public
protocol class `set*`/`get*`/`toCommon*`/`fromCommon*` methods: 762 setters,
784 getters, 215 `toCommon*` methods, and 1 `fromCommon*` method. The checked-in
manifest keeps the original C++ signatures, return types, parameter types/defaults,
`const`/`static` flags, and method kind so class method calls can be generated
from upstream declarations instead of hand-written TypeScript behavior. Those
class APIs are separate from the `IRsend` send surface above, and this Worker
must not claim the protocol class setter/getter surface is complete until those
methods are either exposed through a native-backed schema or explicitly accepted
as out of scope.
The current residual exclusions are generated from the checked-in manifests and
must not be treated as complete parity:

- `worker/test/protocol-class-raw-surface.mjs` excludes 1 class-like
  declaration: `IRArgoACBase` (`ir_Argo.h`). It is an abstract/shared base
  class, not a standalone sendable protocol class.
- `worker/test/protocol-class-method-surface.mjs` exposes 1384 generated instance
  setter/getter methods and excludes 350 methods from the method bridge.
  347 of them are not generated instance
  setter/getter targets for this bridge (`getRaw()`/`setRaw()`, `toCommon*()`,
  `toCommon()`, or static/raw helpers) and are covered by the raw, static,
  common-state, or string bridges where those native calls are linkable. The
  remaining 3 are still not exposed by this bridge: `IRHitachiAc3::getMode`,
  `IRYorkAc::setPowerToggle`, and `IRYorkAc::getPowerToggle` (declared public
  but no linkable implementation in this build).
- `worker/test/protocol-class-static-surface.mjs` exposes 149 static methods and
  excludes 5 static methods. Declarations without a linkable implementation in
  this build: `IRHaierAC176::toCommonTurbo`, `IRHaierAC176::toCommonQuiet`,
  `IRHaierAC160::toCommonTurbo`, `IRHaierAC160::toCommonQuiet`, and
  `IRKelvinatorAC::toCommonSwingV`.
The `worker/test/protocol-class-common-surface.mjs` bridge currently exposes 66
raw-bridge classes that have a linkable public `toCommon()` returning
`stdAc::state_t`, including inherited public methods such as
`IRHaierACYRW02::toCommon()` inherited from `IRHaierAC176`; it excludes
`IRHitachiAc3` because the upstream class does not declare `toCommon()`.
The `worker/test/protocol-class-string-surface.mjs` bridge currently exposes 66
raw-bridge classes that have a linkable public `String toString()`, including
inherited public methods such as `IRHaierACYRW02::toString()` inherited from
`IRHaierAC176`; it excludes `IRHitachiAc3` because the upstream class does not
declare `toString()`.
The `worker/test/protocol-class-from-common-surface.mjs` bridge currently
exposes the single upstream protocol class `fromCommon()` method:
`IRMirageAc::fromCommon(const stdAc::state_t)`.

The Worker stores only event logs in D1. It does not require master data tables.
This repository is a public fork of IRremoteESP8266; keep `LICENSE.txt` with the
distribution.
