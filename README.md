![IRremoteESP8266 Library](./assets/images/banner.svg)

[![Build Status](https://github.com/crankyoldgit/IRremoteESP8266/actions/workflows/Build.yml/badge.svg)](../../actions/workflows/Build.yml)
[![Code Lint](https://github.com/crankyoldgit/IRremoteESP8266/actions/workflows/Lint.yml/badge.svg)](../../actions/workflows/Lint.yml)
[![Tests](https://github.com/crankyoldgit/IRremoteESP8266/actions/workflows/UnitTests.yml/badge.svg)](../../actions/workflows/UnitTests.yml)
[![Documentation](https://github.com/crankyoldgit/IRremoteESP8266/actions/workflows/Documentation.yml/badge.svg)](../../actions/workflows/Documentation.yml/badge.svg)
[![arduino-library-badge](https://www.ardu-badge.com/badge/IRremoteESP8266.svg?)](https://www.ardu-badge.com/IRremoteESP8266)
[![GitLicense](https://gitlicense.com/badge/crankyoldgit/IRremoteESP8266)](https://gitlicense.com/license/crankyoldgit/IRremoteESP8266)

This library enables you to **send _and_ receive** infra-red signals on an [ESP8266](https://github.com/esp8266/Arduino) or an
[ESP32](https://github.com/espressif/arduino-esp32) using the [Arduino framework](https://www.arduino.cc/) using common 940nm IR LEDs and common IR receiver modules. e.g. TSOP{17,22,24,36,38,44,48}* demodulators etc.

## IRremoteWorker Cloudflare API
This repository ships a Hono-based Cloudflare Worker that exposes a JSON API for
generating and inferring IR signals. The Worker calls an Emscripten WebAssembly
build of the original C++ IRremoteESP8266 implementation for both generation and
inference. It does not hand-write protocol inference or raw generation in
TypeScript.

The primary thin-RPC endpoint is `POST /api/call`:

- `{ "op": "protocols" }`
- `{ "op": "infer", "payload": { "raw": [...], "frequency": 38000 } }`
- `{ "op": "generate", "payload": { "kind": "value", "protocol": "NEC", ... } }`

Compatibility endpoints `/api/infer`, `/api/generate`, and `/api/protocols`
remain available and call the same native-backed implementation.

Production endpoint:

```
https://irremote-worker.kazu-san.workers.dev
```

The Worker currently builds all 80 `src/ir_*.cpp` protocol implementation files
with `_IR_ENABLE_DEFAULT_=1`. `GET /api/protocols` reports the exact enabled
surface from the C++ `typeToString()`, `IRsend::defaultBits()`,
`IRsend::minRepeats()`, `hasACState()`, and `IRac::isProtocolSupported()` APIs.
At the time of this update, that is 128 protocol ids: 70 value-style protocols,
58 state-style protocols, and 66 protocols supported by the common A/C API.
Both the WASM build and the native oracle are compiled through
`worker/native/ir_full.cpp`; the older reduced bridge is intentionally not part
of the tree.

The regression suite builds the same C++ bridge twice, once as WASM and once as
a native oracle, then compares protocol listing, value generation, state
generation, raw generation, public helper generation, encoder helper
output, and `IRrecv::decode()` inference output for generated value-style and
state-style raw timings. It also parses `src/IRsend.h` during tests to ensure
the public direct value/state `IRsend::send*` helpers and public
`encode*`/`toggle*` helpers are exposed by the bridge and covered by oracle
comparisons. Current tests assert 132 public `IRsend::send*` names, 19 public
`encode*`/`toggle*` names, and zero untested exposed helper names. The common
A/C API test walks every protocol reported by
`IRac::isProtocolSupported()`: 65 protocols currently produce matching native
raw timings with default common settings, while `YORK` is recorded as the
native `IRac::sendAc()` error case because it is listed as supported but has no
send switch case in the upstream common A/C sender.

### `GET /api/protocols`
Lists the enabled C++ protocol ids and metadata.

Response:

```json
{
  "protocols": [
    {
      "id": "NEC",
      "decodeType": 3,
      "hasState": false,
      "defaultBits": 32,
      "minRepeats": 0,
      "acSupported": false
    }
  ]
}
```

### `POST /api/generate`
Generates IR pulse durations through the original C++ sender code. The request
must use one of these `kind` values:

- `raw`: calls `IRsend::sendRaw()`.
- `value`: calls `IRsend::send(decode_type_t, uint64_t, bits, repeat)`.
- `state`: calls `IRsend::send(decode_type_t, uint8_t *state, nbytes)`.
- `method`: calls public `IRsend` helper methods by C++ method name with args in
  the same order as the upstream signature. This is the REST shape for
  protocol-specific convenience overloads that are not covered by the generic
  value/state/raw forms.
- `encode`: calls public `IRsend` encoder/toggle helpers and returns the value
  they produce.
- `ac`: calls `IRac::sendAc()` for the common A/C API.

For compatibility with the first Worker API, omitting `kind` is treated as
`kind: "ac"`, but `protocol` must now be an exact IRremoteESP8266 protocol id.
Manufacturer guessing is intentionally not used.

Value-style request:

```json
{
  "kind": "value",
  "protocol": "NEC",
  "data": "0x20DF10EF",
  "bits": 32,
  "repeat": 0
}
```

State-style request:

```json
{
  "kind": "state",
  "protocol": "MITSUBISHI_HEAVY_152",
  "state": [173, 81, 60, 200, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "nbytes": 19
}
```

Raw passthrough request:

```json
{
  "kind": "raw",
  "raw": [9000, 4500, 560, 560, 560, 1690],
  "frequency": 38000
}
```

Public helper method request:

```json
{
  "kind": "method",
  "method": "sendPanasonic",
  "args": [16388, 16825341, 48, 0]
}
```

State-array helper methods that have C++ defaults for `nbytes` and `repeat`
can also use a `state` field:

```json
{
  "kind": "method",
  "method": "sendMitsubishiHeavy152",
  "state": [173, 81, 60, 200, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}
```

Currently exposed `method` names are:

- `sendData`
- `sendManchesterData`
- `sendManchester`
- `sendGeneric`
- `sendGenericMesgtime`
- `sendGenericBytes`
- `sendGC`
- `sendPronto`
- `sendSharp`
- `sendPanasonic`
- direct value-style `IRsend` methods with `[data, nbits, repeat]` args:
  `sendNEC`, `sendSony`, `sendSony38`, `sendSherwood`, `sendSAMSUNG`,
  `sendSamsung36`, `sendLG`, `sendLG2`, `sendSharpRaw`, `sendJVC`,
  `sendDenon`, `sendSanyoLC7461`, `sendDISH`, `sendPanasonic64`, `sendRC5`,
  `sendRC6`, `sendRCMM`, `sendCOOLIX`, `sendCoolix48`, `sendWhynter`,
  `sendMitsubishi`, `sendMitsubishi2`, `sendInax`, `sendDaikin64`,
  `sendAiwaRCT501`, `sendGree`, `sendGoodweather`, `sendGorenje`,
  `sendNikai`, `sendMidea`, `sendMidea24`, `sendMagiQuest`, `sendLasertag`,
  `sendCarrierAC`, `sendCarrierAC40`, `sendCarrierAC64`, `sendGICable`,
  `sendLutron`, `sendPanasonicAC32`, `sendPioneer`, `sendVestelAc`,
  `sendTeco`, `sendLegoPf`, `sendEpson`, `sendSymphony`, `sendAirwell`,
  `sendDelonghiAc`, `sendDoshisha`, `sendMultibrackets`, `sendTechnibelAc`,
  `sendZepeal`, `sendMetz`, `sendTranscold`, `sendElitescreens`,
  `sendMilestag2`, `sendEcoclim`, `sendXmp`, `sendTruma`, `sendKelon`,
  `sendBose`, `sendArris`, `sendAirton`, `sendToto`, `sendClimaButler`,
  and `sendWowwee`.
- direct state-array `IRsend` methods with `[nbytes, repeat, ...stateBytes]`
  args: `sendMirage`, `sendMitsubishi136`, `sendMitsubishi112`,
  `sendMitsubishiAC`, `sendMitsubishiHeavy88`, `sendMitsubishiHeavy152`,
  `sendFujitsuAC`, `sendKelvinator`, `sendSamsungAC`, `sendSharpAc`,
  `sendSanyoAc`, `sendSanyoAc88`, `sendSanyoAc152`, `sendDaikin`,
  `sendDaikin128`, `sendDaikin152`, `sendDaikin160`, `sendDaikin176`,
  `sendDaikin2`, `sendDaikin200`, `sendDaikin216`, `sendDaikin312`,
  `sendGree`, `sendArgoWREM3`, `sendTrotec`, `sendTrotec3550`, `sendToshibaAC`,
  `sendCarrierAC84`, `sendCarrierAC128`, `sendHaierAC`, `sendHaierACYRW02`,
  `sendHaierAC160`, `sendHaierAC176`, `sendHitachiAC`, `sendHitachiAC1`,
  `sendHitachiAC2`, `sendHitachiAc3`, `sendHitachiAc264`,
  `sendHitachiAc296`, `sendHitachiAc344`, `sendHitachiAc424`,
  `sendWhirlpoolAC`, `sendElectraAC`, `sendPanasonicAC`, `sendMWM`,
  `sendTcl96Ac`, `sendTcl112Ac`, `sendNeoclima`, `sendAmcor`,
  `sendCoronaAc`, `sendVoltas`, `sendTeknopoint`, `sendKelon168`,
  `sendRhoss`, `sendBosch144`, `sendYork`, `sendBluestarHeavy`, and
  `sendEurom`. `sendArgo` uses `[nbytes, repeat, sendFooter, ...stateBytes]`.
- class-only send helpers that are not listed in `IRsend.h`: `sendArgoSensorTemp`,
  `sendArgoWrem3SensorTemp`, `sendSamsungAcExtended`, `sendSamsungAcOn`, and
  `sendSamsungAcOff`.

For public `IRsend` helper methods with trailing C++ default arguments, the
`method` API accepts the same trailing omissions. Value-style helpers accept
`[data]`, `[data, nbits]`, or `[data, nbits, repeat]`; state-array helpers with
default `nbytes` accept `state: [...]`; `sendSharp` and `sendPanasonic` accept
2 to 4 args; `sendData` accepts 6 or 7; `sendManchesterData` accepts 3 to 5;
and `sendManchester` accepts 7 to 12.

Encoder helper request:

```json
{
  "kind": "encode",
  "method": "encodeNEC",
  "args": [32, 239]
}
```

Currently exposed `encode` names are:

- `encodeNEC`
- `encodeSony`
- `encodeSAMSUNG`
- `encodeLG`
- `encodeSharp`
- `encodeJVC`
- `encodeSanyoLC7461`
- `encodePanasonic`
- `encodeRC5`
- `encodeRC5X`
- `toggleRC5`
- `encodeRC6`
- `toggleRC6`
- `encodeMagiQuest`
- `encodePioneer`
- `encodeDoshisha`
- `encodeMetz`
- `toggleArrisRelease`
- `encodeArris`

Encoder helpers also accept trailing C++ default arguments where the original
method defines them. For example, `encodeSharp` accepts `[address, command]`
through `[address, command, expansion, check, MSBfirst]`; `encodeSony`,
`encodeRC5`, `encodeRC5X`, `encodeRC6`, `toggleRC6`, `encodeDoshisha`, and
`encodeMetz` follow their original C++ defaults.

Common A/C request:

```json
{
  "kind": "ac",
  "protocol": "MITSUBISHI_HEAVY_152",
  "model": -1,
  "power": true,
  "mode": "cool",
  "degrees": 25,
  "celsius": true,
  "fan": "low",
  "swingv": 0,
  "swingh": 0,
  "quiet": false,
  "turbo": false,
  "econo": false,
  "light": false,
  "filter": false,
  "clean": false,
  "beep": true,
  "sleep": -1,
  "clock": -1
}
```

`kind: "ac"` maps to the public `IRac::sendAc()` argument surface:
`protocol`, `model`, `power`, `mode`, `degrees`, `celsius`, `fan`, `swingv`,
`swingh`, `quiet`, `turbo`, `econo`, `light`, `filter`, `clean`, `beep`,
`sleep`, and `clock`. The older `temperatureC` field is accepted as a
backward-compatible alias for `degrees`.

Response shape:

```json
{
  "kind": "value",
  "protocol": "NEC",
  "decodeType": 3,
  "bits": 32,
  "repeat": 0,
  "frequency": 38000,
  "raw": [8960, 4480, 560]
}
```

`raw` is the full mark/space timing sequence captured from the original C++
sender. State requests also echo the `state` bytes used for generation.

Unsupported or invalid generation input is returned as an explicit JSON error
instead of being presented as a supported protocol result:

```json
{
  "error": "unsupported IRsend method"
}
```

### `POST /api/infer`
Infers the most likely protocol from raw pulse durations. The decode itself is
`IRrecv::decode()`. When the decoded message can also be interpreted as an A/C
state, the response includes common A/C fields from
`IRAcUtils::decodeToState()` plus the original human-readable
`IRAcUtils::resultAcToString()` description.
Top-level `manufacturer`, `model`, and `modelName` are populated only when that
native A/C common-state conversion succeeds. `manufacturer` is a display helper
mechanically derived from the native common-state protocol id; it is not a
separate TypeScript classifier. Non-A/C protocol matches keep those fields as
`null`; `protocol` remains the decoded protocol name and source of truth.

Example request:

```json
{
  "raw": [3140, 1630, 370, 420, 370, 1220],
  "frequency": 38000
}
```

Example response shape:

```json
{
  "matched": true,
  "protocol": "PANASONIC_AC",
  "manufacturer": "PANASONIC",
  "model": 4,
  "modelName": "JKE",
  "decodeType": 48,
  "decode_type": 48,
  "bits": 216,
  "value": "0",
  "valueHex": "0x0",
  "value_hex": "0x0",
  "address": 0,
  "command": 0,
  "repeat": false,
  "rawlen": 308,
  "overflow": false,
  "state": [173, 81, 60],
  "frequency": 38000,
  "rawLength": 307,
  "raw_length": 307,
  "ac": {
    "protocol": "PANASONIC_AC",
    "manufacturer": "PANASONIC",
    "model": 4,
    "modelName": "JKE",
    "power": true,
    "mode": "Cool",
    "modeId": 1,
    "degrees": 26,
    "celsius": true,
    "fan": "Auto",
    "fanId": 0,
    "swingv": "Auto",
    "swingvId": 0,
    "swingh": "Auto",
    "swinghId": 0,
    "quiet": false,
    "turbo": false,
    "econo": false,
    "light": false,
    "filter": false,
    "clean": false,
    "beep": false,
    "sleep": -1,
    "clock": -1,
    "command": "Control",
    "commandId": 0,
    "iFeel": false,
    "sensorTemperature": null,
    "description": "Model: 4 (JKE), Power: On, Mode: 3 (Cool), Temp: 26C",
    "sourceProtocol": "PANASONIC_AC"
  }
}
```

If the raw input cannot be matched, the response is:

```json
{
  "matched": false,
  "rawLength": 0,
  "raw_length": 0,
  "frequency": null
}
```

For compatibility with both JavaScript-style and native `decode_results` naming,
matched inference responses include `decodeType` and `decode_type`, `valueHex`
and `value_hex`, plus `rawLength` and `raw_length`.

### `GET /api/latest`
Returns the most recent generate or infer event. Events are stored in the D1
`irremote_logs` database when the Worker binding is available, and the raw IR
data is preserved in `raw_json`.

Response shape:

```json
{
  "latest": {
    "id": "uuid",
    "created_at": "2026-06-04T14:28:19.176Z",
    "kind": "infer",
    "protocol": "PANASONIC_AC",
    "manufacturer": "PANASONIC",
    "model": 4,
    "request_json": "{\"raw\":[...]}",
    "response_json": "{\"matched\":true,...}",
    "raw_json": "[...]"
  }
}
```

### `GET /`
Shows a minimal status page that polls `/api/latest` and displays the latest
event. It is intentionally small and does not list historical events.

### Local development

```sh
npm install
npm run db:migrate:local
npm run dev
```

Useful verification commands:

```sh
npm test
npm run build
npm run verify:local
npm run deploy:dry-run
npm run deploy
npm run verify:prod
```

`npm test` rebuilds the Worker WebAssembly module from the original C++ sources,
builds a native C++ oracle from the same bridge, and checks:

- protocol list parity for every enabled C++ protocol id;
- generic value generation parity for every value protocol accepted by
  `IRsend::send()`;
- generic state generation parity for every state protocol accepted by
  `IRsend::send()`;
- raw passthrough generation parity;
- public `IRsend` helper method generation parity;
- direct value/state `IRsend` method raw timing inference parity against
  `IRrecv::decode()`;
- public encoder/toggle helper output parity;
- encoder output used as value generation input;
- full common A/C API generation parity against `IRac::sendAc()`;
- inference parity for generated raw timings through `IRrecv::decode()`;
- inference parity for 185 numeric upstream `test/ir_*_test.cpp` raw decode
  fixtures through `IRrecv::decode()`; `ir_Arris_test.cpp:rawData_1` is skipped
  because it is not a pure numeric initializer;
- HTTP API parity for `/api/protocols`, `/api/generate`, and `/api/infer`
  against the same native oracle, including explicit JSON errors for
  unsupported generation input.

`npm run verify:local` starts `wrangler dev --local`, then compares the local
HTTP Worker endpoint against the native oracle for protocol inventory, value
generation, state generation, raw generation, generated raw inference for
value/state output, Panasonic A/C common state fields, an upstream ClimaButler
decode fixture, and unsupported method error handling. `npm run verify:prod`
repeats the same native-oracle checks against the deployed Worker endpoint.

REST surface note: protocol-specific `IRsend::send*` convenience overloads use
the `kind: "method"` schema with the C++ method name and ordered `args`; the
class-only send helpers above are also exposed there. The Worker does not expose
stateful protocol class setter/getter APIs as separate REST object schemas; use
`kind: "state"`, direct state-array `method` calls, encoder helpers, or the
common `IRac::sendAc()` API for generation.

## v2.9.0 Now Available
Version 2.9.0 of the library is now [available](https://github.com/crankyoldgit/IRremoteESP8266/releases/latest). You can view the [Release Notes](ReleaseNotes.md) for all the significant changes.

#### Upgrading from pre-v2.0
Usage of the library has been slightly changed in v2.0. You will need to change your usage to work with v2.0 and beyond. You can read more about the changes required on our [Upgrade to v2.0](https://github.com/crankyoldgit/IRremoteESP8266/wiki/Upgrading-to-v2.0) page.

#### Upgrading from pre-v2.5
The library has changed from using constants declared as `#define` to
[const](https://google.github.io/styleguide/cppguide.html#Constant_Names) with
the appropriate naming per the
[C++ style guide](https://google.github.io/styleguide/cppguide.html).
This may potentially cause old programs to not compile.
The most likely externally used `#define`s have been _aliased_ for limited
backward compatibility for projects using the old style. Going forward, only the
new `kConstantName` style will be supported for new protocol additions.

In the unlikely case, it does break your code, then you may have been referencing
something you likely should not have. You should be able to quickly determine
the new name from the old. e.g. `CONSTANT_NAME` to `kConstantName`.
Use common sense or examining the library's code if this does affect code.

## Supported Protocols
You can find the details of which protocols & devices are supported
[here](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/SupportedProtocols.md).

## Troubleshooting
Before reporting an issue or asking for help, please try to follow our [Troubleshooting Guide](https://github.com/crankyoldgit/IRremoteESP8266/wiki/Troubleshooting-Guide) first.

## Frequently Asked Questions
Some common answers to common questions and problems are on our [F.A.Q. wiki page](https://github.com/crankyoldgit/IRremoteESP8266/wiki/Frequently-Asked-Questions).

## Library API Documentation
This library uses [Doxygen](https://www.doxygen.nl/index.html) to [automatically document](https://crankyoldgit.github.io/IRremoteESP8266/doxygen/html/) the [library's](https://crankyoldgit.github.io/IRremoteESP8266/doxygen/html/) [API](https://en.wikipedia.org/wiki/Application_programming_interface).
You can find it [here](https://crankyoldgit.github.io/IRremoteESP8266/doxygen/html/).

## Installation
##### Official releases via the Arduino IDE v1.8+ (Windows & Linux)
1. Click the _"Sketch"_ -> _"Include Library"_ -> _"Manage Libraries..."_ Menu items.
1. Enter `IRremoteESP8266` into the _"Filter your search..."_ top right search box.
1. Click on the IRremoteESP8266 result of the search.
1. Select the version you wish to install and click _"Install"_.

##### Manual Installation for Windows
1. Click on _"Clone or Download"_ button, then _"[Download ZIP](https://github.com/crankyoldgit/IRremoteESP8266/archive->master.zip)"_ on the page.
1. Extract the contents of the downloaded zip file.
1. Rename the extracted folder to _"IRremoteESP8266"_.
1. Move this folder to your libraries directory. (under windows: `C:\Users\YOURNAME\Documents\Arduino\libraries\`)
1. Restart your Arduino IDE.
1. Check out the examples.

##### Using Git to install the library ( Linux )
```
cd ~/Arduino/libraries
git clone https://github.com/crankyoldgit/IRremoteESP8266.git
```
###### To update to the latest version of the library
```
cd ~/Arduino/libraries/IRremoteESP8266 && git pull
```

## Contributing
If you want to [contribute](.github/CONTRIBUTING.md#how-can-i-contribute) to this project, consider:
- [Reporting](.github/CONTRIBUTING.md#reporting-bugs) bugs and errors
- Ask for enhancements
- Improve our documentation
- [Creating issues](.github/CONTRIBUTING.md#reporting-bugs) and [pull requests](.github/CONTRIBUTING.md#pull-requests)
- Tell other people about this library
- Updated documentation formatting and clarified installation steps (Hacktoberfest contribution by Prerna Utage)


## Contributors
Available [here](.github/Contributors.md)

## Library History
This library was originally based on Ken Shirriff's work (https://github.com/shirriff/Arduino-IRremote/)

[Mark Szabo](https://github.com/crankyoldgit/IRremoteESP8266) has updated the IRsend class to work on ESP8266 and [Sebastien Warin](https://github.com/sebastienwarin/IRremoteESP8266) the receiving & decoding part (IRrecv class).

As of v2.0, the library was almost entirely re-written with the ESP8266's resources in mind.

## About This Project
This project allows decoding and encoding of IR signals for controlling Air Conditioners and other devices using ESP8266 or ESP32 boards.
