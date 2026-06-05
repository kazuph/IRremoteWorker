#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

#include "IRac.h"
#include "IRrecv.h"
#include "IRsend.h"
#include "IRutils.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define IR_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define IR_EXPORT
#endif

namespace {

std::string last_json;

class CapturingIRsend : public IRsend {
 public:
  explicit CapturingIRsend(uint16_t pin) : IRsend(pin) { _freq_unittest = 0; }
  uint32_t frequency() const { return _freq_unittest; }
};

std::string escapeJson(const std::string &value) {
  std::ostringstream out;
  for (char c : value) {
    switch (c) {
      case '\\': out << "\\\\"; break;
      case '"': out << "\\\""; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          out << "\\u"
              << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<int>(static_cast<unsigned char>(c))
              << std::dec << std::setfill(' ');
        } else {
          out << c;
        }
        break;
    }
  }
  return out.str();
}

std::string protocolName(decode_type_t type) {
  return std::string(typeToString(type).c_str());
}

std::string manufacturerFromAcProtocol(const std::string &protocol) {
  if (protocol == "UNKNOWN" || protocol == "?") return "";
  std::string root = protocol;
  const size_t ac_suffix = root.find("_AC");
  if (ac_suffix != std::string::npos) {
    root = root.substr(0, ac_suffix);
  } else if (root.size() >= 2 && root.compare(root.size() - 2, 2, "AC") == 0) {
    root.resize(root.size() - 2);
  }
  while (!root.empty() && std::isdigit(static_cast<unsigned char>(root.back()))) {
    root.pop_back();
  }
  while (!root.empty() && root.back() == '_') {
    root.pop_back();
  }
  return root;
}

std::string hex64(uint64_t value) {
  const char *digits = "0123456789ABCDEF";
  std::string out = "0x";
  bool started = false;
  for (int shift = 60; shift >= 0; shift -= 4) {
    const uint8_t nibble = (value >> shift) & 0xF;
    if (nibble || started || shift == 0) {
      out += digits[nibble];
      started = true;
    }
  }
  return out;
}

uint64_t parseUint64(const char *value) {
  if (value == nullptr) return 0;
  return strtoull(value, nullptr, 0);
}

std::vector<uint32_t> parseNumbers(const char *csv) {
  std::vector<uint32_t> values;
  if (csv == nullptr || *csv == '\0') return values;
  const char *cursor = csv;
  while (*cursor) {
    char *end = nullptr;
    const unsigned long value = std::strtoul(cursor, &end, 0);
    if (end == cursor) break;
    values.push_back(static_cast<uint32_t>(value));
    cursor = end;
    if (*cursor == ',') cursor++;
  }
  return values;
}

std::vector<uint64_t> parseWideNumbers(const char *csv) {
  std::vector<uint64_t> values;
  if (csv == nullptr || *csv == '\0') return values;
  const char *cursor = csv;
  while (*cursor) {
    char *end = nullptr;
    const unsigned long long value = std::strtoull(cursor, &end, 0);
    if (end == cursor) break;
    values.push_back(static_cast<uint64_t>(value));
    cursor = end;
    if (*cursor == ',') cursor++;
  }
  return values;
}

std::vector<uint8_t> parseState(const char *csv) {
  std::vector<uint8_t> state;
  for (uint32_t value : parseNumbers(csv)) {
    state.push_back(static_cast<uint8_t>(value & 0xFF));
  }
  return state;
}

void appendTimingList(std::ostringstream &out, const char *key) {
  out << "\"" << key << "\":[";
  for (size_t i = 0; i < timingList.size(); i++) {
    if (i) out << ",";
    out << timingList[i];
  }
  out << "]";
}

void appendState(std::ostringstream &out, const uint8_t *state, size_t length) {
  out << "\"state\":[";
  for (size_t i = 0; i < length; i++) {
    if (i) out << ",";
    out << static_cast<int>(state[i]);
  }
  out << "]";
}

void appendOptionalFloat(std::ostringstream &out, const char *key, float value) {
  out << "\"" << key << "\":";
  if (value == kNoTempValue) {
    out << "null";
  } else {
    out << value;
  }
}

void appendCommonAcObject(std::ostringstream &out, const stdAc::state_t &state,
                          const std::string &description,
                          const std::string &sourceProtocol) {
  const std::string protocol = protocolName(state.protocol);
  const std::string manufacturer = manufacturerFromAcProtocol(protocol);
  const std::string modelName = std::string(irutils::modelToStr(state.protocol, state.model).c_str());

  out << "\"ac\":{";
  out << "\"protocol\":\"" << escapeJson(protocol) << "\",";
  if (manufacturer.empty()) {
    out << "\"manufacturer\":null,";
  } else {
    out << "\"manufacturer\":\"" << escapeJson(manufacturer) << "\",";
  }
  out << "\"model\":" << state.model << ",";
  out << "\"modelName\":\"" << escapeJson(modelName) << "\",";
  out << "\"power\":" << (state.power ? "true" : "false") << ",";
  out << "\"mode\":\"" << escapeJson(std::string(IRac::opmodeToString(state.mode).c_str())) << "\",";
  out << "\"modeId\":" << static_cast<int>(state.mode) << ",";
  out << "\"degrees\":" << state.degrees << ",";
  out << "\"celsius\":" << (state.celsius ? "true" : "false") << ",";
  out << "\"fan\":\"" << escapeJson(std::string(IRac::fanspeedToString(state.fanspeed).c_str())) << "\",";
  out << "\"fanId\":" << static_cast<int>(state.fanspeed) << ",";
  out << "\"swingv\":\"" << escapeJson(std::string(IRac::swingvToString(state.swingv).c_str())) << "\",";
  out << "\"swingvId\":" << static_cast<int>(state.swingv) << ",";
  out << "\"swingh\":\"" << escapeJson(std::string(IRac::swinghToString(state.swingh).c_str())) << "\",";
  out << "\"swinghId\":" << static_cast<int>(state.swingh) << ",";
  out << "\"quiet\":" << (state.quiet ? "true" : "false") << ",";
  out << "\"turbo\":" << (state.turbo ? "true" : "false") << ",";
  out << "\"econo\":" << (state.econo ? "true" : "false") << ",";
  out << "\"light\":" << (state.light ? "true" : "false") << ",";
  out << "\"filter\":" << (state.filter ? "true" : "false") << ",";
  out << "\"clean\":" << (state.clean ? "true" : "false") << ",";
  out << "\"beep\":" << (state.beep ? "true" : "false") << ",";
  out << "\"sleep\":" << state.sleep << ",";
  out << "\"clock\":" << state.clock << ",";
  out << "\"command\":\"" << escapeJson(std::string(IRac::commandTypeToString(state.command).c_str())) << "\",";
  out << "\"commandId\":" << static_cast<int>(state.command) << ",";
  out << "\"iFeel\":" << (state.iFeel ? "true" : "false") << ",";
  appendOptionalFloat(out, "sensorTemperature", state.sensorTemperature);
  out << ",";
  out << "\"description\":\"" << escapeJson(description) << "\",";
  out << "\"sourceProtocol\":\"" << escapeJson(sourceProtocol) << "\"";
  out << "}";
}

void appendAcState(std::ostringstream &out, const decode_results &results,
                   const stdAc::state_t &state,
                   const std::string &description, bool hasCommonState) {
  const std::string protocol = protocolName(state.protocol);
  if (hasCommonState) {
    appendCommonAcObject(out, state, description, protocolName(results.decode_type));
    return;
  }

  out << "\"ac\":{";
  out << "\"protocol\":\"" << escapeJson(protocol) << "\",";
  if (!hasCommonState) {
    out << "\"manufacturer\":null,";
    out << "\"model\":null,";
    out << "\"modelName\":null,";
    out << "\"description\":\"" << escapeJson(description) << "\",";
    out << "\"sourceProtocol\":\"" << escapeJson(protocolName(results.decode_type)) << "\"";
    out << "}";
    return;
  }
}

std::string errorJson(const char *message) {
  std::ostringstream out;
  out << "{\"error\":\"" << escapeJson(message) << "\"}";
  return out.str();
}

std::string generatedMethodJson(const char *method, uint32_t frequency) {
  std::ostringstream out;
  out << "{";
  out << "\"kind\":\"method\",";
  out << "\"method\":\"" << escapeJson(method) << "\",";
  out << "\"frequency\":";
  if (frequency > 0) {
    out << frequency;
  } else {
    out << "null";
  }
  out << ",";
  appendTimingList(out, "raw");
  out << "}";
  return out.str();
}

std::string encodeResultJson(const char *method, uint64_t value) {
  std::ostringstream out;
  out << "{";
  out << "\"kind\":\"encode\",";
  out << "\"method\":\"" << escapeJson(method) << "\",";
  out << "\"value\":\"" << static_cast<unsigned long long>(value) << "\",";
  out << "\"valueHex\":\"" << hex64(value) << "\"";
  out << "}";
  return out.str();
}

std::string generatedJson(const char *kind, decode_type_t type, uint16_t bits,
                          uint16_t repeat, uint32_t frequency) {
  const std::string protocol = protocolName(type);
  std::ostringstream out;
  out << "{";
  out << "\"kind\":\"" << kind << "\",";
  out << "\"protocol\":\"" << escapeJson(protocol) << "\",";
  out << "\"decodeType\":" << static_cast<int>(type) << ",";
  out << "\"bits\":" << bits << ",";
  out << "\"repeat\":" << repeat << ",";
  out << "\"frequency\":";
  if (frequency > 0) {
    out << frequency;
  } else {
    out << "null";
  }
  out << ",";
  appendTimingList(out, "raw");
  out << "}";
  return out.str();
}

stdAc::opmode_t parseMode(const char *mode) {
  if (mode == nullptr) return stdAc::opmode_t::kAuto;
  if (!std::strcmp(mode, "off")) return stdAc::opmode_t::kOff;
  if (!std::strcmp(mode, "cool")) return stdAc::opmode_t::kCool;
  if (!std::strcmp(mode, "heat")) return stdAc::opmode_t::kHeat;
  if (!std::strcmp(mode, "dry")) return stdAc::opmode_t::kDry;
  if (!std::strcmp(mode, "fan")) return stdAc::opmode_t::kFan;
  return stdAc::opmode_t::kAuto;
}

stdAc::fanspeed_t parseFan(const char *fan) {
  if (fan == nullptr) return stdAc::fanspeed_t::kAuto;
  if (!std::strcmp(fan, "min")) return stdAc::fanspeed_t::kMin;
  if (!std::strcmp(fan, "low")) return stdAc::fanspeed_t::kLow;
  if (!std::strcmp(fan, "medium")) return stdAc::fanspeed_t::kMedium;
  if (!std::strcmp(fan, "high")) return stdAc::fanspeed_t::kHigh;
  if (!std::strcmp(fan, "max")) return stdAc::fanspeed_t::kMax;
  return stdAc::fanspeed_t::kAuto;
}

stdAc::state_t commonStateFromArgs(decode_type_t protocol, int model, int power,
                                   const char *mode, int temperatureC,
                                   int celsius, const char *fan, int swingv,
                                   int swingh, int quiet, int turbo, int econo,
                                   int light, int filter, int clean, int beep,
                                   int sleep, int clock, int ifeel,
                                   int sensorTemperature) {
  stdAc::state_t state{};
  state.protocol = protocol;
  state.model = model;
  state.power = power != 0;
  state.mode = parseMode(mode);
  state.degrees = temperatureC;
  state.celsius = celsius != 0;
  state.fanspeed = parseFan(fan);
  state.swingv = static_cast<stdAc::swingv_t>(swingv);
  state.swingh = static_cast<stdAc::swingh_t>(swingh);
  state.quiet = quiet != 0;
  state.turbo = turbo != 0;
  state.econo = econo != 0;
  state.light = light != 0;
  state.filter = filter != 0;
  state.clean = clean != 0;
  state.beep = beep != 0;
  state.sleep = sleep;
  state.clock = clock;
  state.iFeel = ifeel != 0;
  state.sensorTemperature = sensorTemperature < 0 ? kNoTempValue : sensorTemperature;
  return state;
}

std::string inferJson(const decode_results &results, int frequency) {
  const std::string protocol = protocolName(results.decode_type);
  stdAc::state_t acState;
  const std::string acDescription = std::string(IRAcUtils::resultAcToString(&results).c_str());
  const bool hasCommonAcState = !acDescription.empty() && IRAcUtils::decodeToState(&results, &acState, nullptr);
  const bool hasAc = hasCommonAcState || !acDescription.empty();
  if (!hasCommonAcState) acState.protocol = results.decode_type;
  const std::string manufacturer = hasCommonAcState ? manufacturerFromAcProtocol(protocolName(acState.protocol)) : "";
  std::ostringstream out;
  out << "{";
  out << "\"matched\":true,";
  out << "\"protocol\":\"" << escapeJson(protocol) << "\",";
  if (manufacturer.empty()) {
    out << "\"manufacturer\":null,";
  } else {
    out << "\"manufacturer\":\"" << escapeJson(manufacturer) << "\",";
  }
  if (hasCommonAcState) {
    out << "\"model\":" << acState.model << ",";
    out << "\"modelName\":\"" << escapeJson(std::string(irutils::modelToStr(acState.protocol, acState.model).c_str())) << "\",";
  } else {
    out << "\"model\":null,";
    out << "\"modelName\":null,";
  }
  out << "\"decodeType\":" << static_cast<int>(results.decode_type) << ",";
  out << "\"decode_type\":" << static_cast<int>(results.decode_type) << ",";
  out << "\"bits\":" << results.bits << ",";
  out << "\"value\":\"" << static_cast<unsigned long long>(results.value) << "\",";
  out << "\"valueHex\":\"" << hex64(results.value) << "\",";
  out << "\"value_hex\":\"" << hex64(results.value) << "\",";
  out << "\"address\":" << results.address << ",";
  out << "\"command\":" << results.command << ",";
  out << "\"repeat\":" << (results.repeat ? "true" : "false") << ",";
  out << "\"rawlen\":" << results.rawlen << ",";
  out << "\"overflow\":" << (results.overflow ? "true" : "false") << ",";
  out << "\"frequency\":" << frequency << ",";
  if (hasACState(results.decode_type)) {
    appendState(out, results.state, results.bits / 8);
  } else {
    out << "\"state\":null";
  }
  out << ",";
  out << "\"rawLength\":" << (results.rawlen > 0 ? results.rawlen - 1 : 0) << ",";
  out << "\"raw_length\":" << (results.rawlen > 0 ? results.rawlen - 1 : 0) << ",";
  if (hasAc) {
    appendAcState(out, results, acState, acDescription, hasCommonAcState);
  } else {
    out << "\"ac\":null";
  }
  out << "}";
  return out.str();
}

}  // namespace

#include "generated_class_raw_bridge.h"
#include "generated_class_method_bridge.h"
#include "generated_class_static_bridge.h"
#include "generated_class_common_bridge.h"
#include "generated_class_string_bridge.h"
#include "generated_class_from_common_bridge.h"

extern "C" {

IR_EXPORT
const char *ir_generate_ac_full_json(const char *protocol, int model, int power,
                                     const char *mode, int temperatureC,
                                     int celsius, const char *fan,
                                     int swingv, int swingh, int quiet,
                                     int turbo, int econo, int light,
                                     int filter, int clean, int beep,
                                     int sleep, int clock);

IR_EXPORT
const char *ir_generate_class_json(const char *className, const char *state_csv,
                                   const char *raw_value, int repeat) {
  const std::vector<uint8_t> state = parseState(state_csv);
  std::string result;
  if (!generateClassRawJson(className, state, parseUint64(raw_value),
                            static_cast<uint16_t>(repeat), result)) {
    last_json = errorJson("unsupported protocol class raw generation");
    return last_json.c_str();
  }
  last_json = result;
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_class_method_json(const char *className,
                                          const char *state_csv,
                                          const char *raw_value,
                                          const char *methodName,
                                          const char *args_csv) {
  const std::vector<uint8_t> state = parseState(state_csv);
  std::string result;
  if (!generateClassMethodJson(className, state, parseUint64(raw_value),
                               methodName, args_csv, result)) {
    last_json = errorJson("unsupported protocol class scalar method");
    return last_json.c_str();
  }
  last_json = result;
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_class_static_json(const char *className,
                                          const char *state_csv,
                                          const char *methodName,
                                          const char *args_csv) {
  const std::vector<uint8_t> state = parseState(state_csv);
  std::string result;
  if (!generateClassStaticJson(className, state, methodName, args_csv, result)) {
    last_json = errorJson("unsupported protocol class static method");
    return last_json.c_str();
  }
  last_json = result;
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_class_common_json(const char *className,
                                          const char *state_csv,
                                          const char *raw_value) {
  const std::vector<uint8_t> state = parseState(state_csv);
  std::string result;
  if (!generateClassCommonJson(className, state, parseUint64(raw_value),
                               result)) {
    last_json = errorJson("unsupported protocol class common conversion");
    return last_json.c_str();
  }
  last_json = result;
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_class_string_json(const char *className,
                                          const char *state_csv,
                                          const char *raw_value) {
  const std::vector<uint8_t> state = parseState(state_csv);
  std::string result;
  if (!generateClassStringJson(className, state, parseUint64(raw_value),
                               result)) {
    last_json = errorJson("unsupported protocol class string conversion");
    return last_json.c_str();
  }
  last_json = result;
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_class_from_common_json(
    const char *className, int model, int power, const char *mode,
    int temperatureC, int celsius, const char *fan, int swingv, int swingh,
    int quiet, int turbo, int econo, int light, int filter, int clean, int beep,
    int sleep, int clock, int ifeel, int sensorTemperature, int repeat) {
  const decode_type_t protocol = className != nullptr &&
                                        !std::strcmp(className, "IRMirageAc")
                                    ? decode_type_t::MIRAGE
                                    : decode_type_t::UNKNOWN;
  const stdAc::state_t common = commonStateFromArgs(
      protocol, model, power, mode, temperatureC, celsius, fan, swingv, swingh,
      quiet, turbo, econo, light, filter, clean, beep, sleep, clock, ifeel,
      sensorTemperature);
  std::string result;
  if (!generateClassFromCommonJson(className, common,
                                   static_cast<uint16_t>(repeat), result)) {
    last_json = errorJson("unsupported protocol class fromCommon conversion");
    return last_json.c_str();
  }
  last_json = result;
  return last_json.c_str();
}

IR_EXPORT
const char *ir_protocols_json() {
  std::ostringstream out;
  out << "{\"protocols\":[";
  bool first = true;
  for (int i = 1; i <= kLastDecodeType; i++) {
    const decode_type_t type = static_cast<decode_type_t>(i);
    const std::string name = protocolName(type);
    if (name == "?" || name == "UNKNOWN") continue;
    if (!first) out << ",";
    first = false;
    out << "{\"id\":\"" << escapeJson(name) << "\",";
    out << "\"decodeType\":" << i << ",";
    out << "\"hasState\":" << (hasACState(type) ? "true" : "false") << ",";
    out << "\"defaultBits\":" << IRsend::defaultBits(type) << ",";
    out << "\"minRepeats\":" << IRsend::minRepeats(type) << ",";
    out << "\"acSupported\":" << (IRac::isProtocolSupported(type) ? "true" : "false") << "}";
  }
  out << "]}";
  last_json = out.str();
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_value_json(const char *protocol, const char *data,
                                   int bits, int repeat) {
  const decode_type_t type = strToDecodeType(protocol);
  if (type == UNKNOWN) {
    last_json = errorJson("unknown protocol");
    return last_json.c_str();
  }
  const uint16_t nbits = bits > 0 ? bits : IRsend::defaultBits(type);
  timingList.clear();
  CapturingIRsend sender(0);
  if (!sender.send(type, parseUint64(data), nbits, repeat)) {
    last_json = errorJson("unsupported value generation for protocol");
    return last_json.c_str();
  }
  last_json = generatedJson("value", type, nbits, repeat, sender.frequency());
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_state_json(const char *protocol, const char *state_csv,
                                   int nbytes) {
  const decode_type_t type = strToDecodeType(protocol);
  if (type == UNKNOWN) {
    last_json = errorJson("unknown protocol");
    return last_json.c_str();
  }
  const std::vector<uint8_t> state = parseState(state_csv);
  const uint16_t length = nbytes > 0 ? nbytes : state.size();
  if (state.size() < length) {
    last_json = errorJson("state is shorter than nbytes");
    return last_json.c_str();
  }
  timingList.clear();
  CapturingIRsend sender(0);
  if (!sender.send(type, state.data(), length)) {
    last_json = errorJson("unsupported state generation for protocol");
    return last_json.c_str();
  }
  std::ostringstream out;
  out << "{";
  out << "\"kind\":\"state\",";
  out << "\"protocol\":\"" << escapeJson(protocolName(type)) << "\",";
  out << "\"decodeType\":" << static_cast<int>(type) << ",";
  out << "\"bits\":" << (length * 8) << ",";
  out << "\"repeat\":0,";
  out << "\"frequency\":" << sender.frequency() << ",";
  appendState(out, state.data(), length);
  out << ",";
  appendTimingList(out, "raw");
  out << "}";
  last_json = out.str();
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_raw_json(const char *raw_csv, int frequency) {
  const std::vector<uint32_t> raw32 = parseNumbers(raw_csv);
  if (raw32.empty()) {
    last_json = errorJson("raw must not be empty");
    return last_json.c_str();
  }
  std::vector<uint16_t> raw;
  for (uint32_t value : raw32) {
    raw.push_back(static_cast<uint16_t>(std::min<uint32_t>(value, UINT16_MAX)));
  }
  timingList.clear();
  CapturingIRsend sender(0);
  sender.sendRaw(raw.data(), raw.size(), frequency > 0 ? frequency : 38000);
  last_json = generatedJson("raw", RAW, raw.size(), 0, sender.frequency());
  return last_json.c_str();
}

IR_EXPORT
const char *ir_encode_json(const char *method, const char *args_csv) {
  if (method == nullptr) {
    last_json = errorJson("method is required");
    return last_json.c_str();
  }
  const std::vector<uint64_t> args = parseWideNumbers(args_csv);
  CapturingIRsend sender(0);
  uint64_t value = 0;

  if (!std::strcmp(method, "encodeNEC")) {
    if (args.size() != 2) {
      last_json = errorJson("encodeNEC requires 2 args");
      return last_json.c_str();
    }
    value = sender.encodeNEC(args[0], args[1]);
  } else if (!std::strcmp(method, "encodeSony")) {
    if (args.size() < 3 || args.size() > 4) {
      last_json = errorJson("encodeSony requires 3 or 4 args");
      return last_json.c_str();
    }
    if (args.size() == 3) {
      value = sender.encodeSony(args[0], args[1], args[2]);
    } else {
      value = sender.encodeSony(args[0], args[1], args[2], args[3]);
    }
  } else if (!std::strcmp(method, "encodeSAMSUNG")) {
    if (args.size() != 2) {
      last_json = errorJson("encodeSAMSUNG requires 2 args");
      return last_json.c_str();
    }
    value = sender.encodeSAMSUNG(args[0], args[1]);
  } else if (!std::strcmp(method, "encodeLG")) {
    if (args.size() != 2) {
      last_json = errorJson("encodeLG requires 2 args");
      return last_json.c_str();
    }
    value = sender.encodeLG(args[0], args[1]);
  } else if (!std::strcmp(method, "encodeSharp")) {
    if (args.size() < 2 || args.size() > 5) {
      last_json = errorJson("encodeSharp requires 2 to 5 args");
      return last_json.c_str();
    }
    if (args.size() == 2) {
      value = sender.encodeSharp(args[0], args[1]);
    } else if (args.size() == 3) {
      value = sender.encodeSharp(args[0], args[1], args[2]);
    } else if (args.size() == 4) {
      value = sender.encodeSharp(args[0], args[1], args[2], args[3]);
    } else {
      value = sender.encodeSharp(args[0], args[1], args[2], args[3], args[4] != 0);
    }
  } else if (!std::strcmp(method, "encodeJVC")) {
    if (args.size() != 2) {
      last_json = errorJson("encodeJVC requires 2 args");
      return last_json.c_str();
    }
    value = sender.encodeJVC(args[0], args[1]);
  } else if (!std::strcmp(method, "encodeSanyoLC7461")) {
    if (args.size() != 2) {
      last_json = errorJson("encodeSanyoLC7461 requires 2 args");
      return last_json.c_str();
    }
    value = sender.encodeSanyoLC7461(args[0], args[1]);
  } else if (!std::strcmp(method, "encodePanasonic")) {
    if (args.size() != 4) {
      last_json = errorJson("encodePanasonic requires 4 args");
      return last_json.c_str();
    }
    value = sender.encodePanasonic(args[0], args[1], args[2], args[3]);
  } else if (!std::strcmp(method, "encodeRC5")) {
    if (args.size() < 2 || args.size() > 3) {
      last_json = errorJson("encodeRC5 requires 2 or 3 args");
      return last_json.c_str();
    }
    if (args.size() == 2) {
      value = sender.encodeRC5(args[0], args[1]);
    } else {
      value = sender.encodeRC5(args[0], args[1], args[2] != 0);
    }
  } else if (!std::strcmp(method, "encodeRC5X")) {
    if (args.size() < 2 || args.size() > 3) {
      last_json = errorJson("encodeRC5X requires 2 or 3 args");
      return last_json.c_str();
    }
    if (args.size() == 2) {
      value = sender.encodeRC5X(args[0], args[1]);
    } else {
      value = sender.encodeRC5X(args[0], args[1], args[2] != 0);
    }
  } else if (!std::strcmp(method, "toggleRC5")) {
    if (args.size() != 1) {
      last_json = errorJson("toggleRC5 requires 1 arg");
      return last_json.c_str();
    }
    value = sender.toggleRC5(args[0]);
  } else if (!std::strcmp(method, "encodeRC6")) {
    if (args.size() < 2 || args.size() > 3) {
      last_json = errorJson("encodeRC6 requires 2 or 3 args");
      return last_json.c_str();
    }
    if (args.size() == 2) {
      value = sender.encodeRC6(args[0], args[1]);
    } else {
      value = sender.encodeRC6(args[0], args[1], args[2]);
    }
  } else if (!std::strcmp(method, "toggleRC6")) {
    if (args.size() < 1 || args.size() > 2) {
      last_json = errorJson("toggleRC6 requires 1 or 2 args");
      return last_json.c_str();
    }
    if (args.size() == 1) {
      value = sender.toggleRC6(args[0]);
    } else {
      value = sender.toggleRC6(args[0], args[1]);
    }
  } else if (!std::strcmp(method, "encodeMagiQuest")) {
    if (args.size() != 2) {
      last_json = errorJson("encodeMagiQuest requires 2 args");
      return last_json.c_str();
    }
    value = sender.encodeMagiQuest(args[0], args[1]);
  } else if (!std::strcmp(method, "encodePioneer")) {
    if (args.size() != 2) {
      last_json = errorJson("encodePioneer requires 2 args");
      return last_json.c_str();
    }
    value = sender.encodePioneer(args[0], args[1]);
  } else if (!std::strcmp(method, "encodeDoshisha")) {
    if (args.size() < 1 || args.size() > 2) {
      last_json = errorJson("encodeDoshisha requires 1 or 2 args");
      return last_json.c_str();
    }
    if (args.size() == 1) {
      value = sender.encodeDoshisha(args[0]);
    } else {
      value = sender.encodeDoshisha(args[0], args[1]);
    }
  } else if (!std::strcmp(method, "encodeMetz")) {
    if (args.size() < 2 || args.size() > 3) {
      last_json = errorJson("encodeMetz requires 2 or 3 args");
      return last_json.c_str();
    }
    if (args.size() == 2) {
      value = IRsend::encodeMetz(args[0], args[1]);
    } else {
      value = IRsend::encodeMetz(args[0], args[1], args[2] != 0);
    }
  } else if (!std::strcmp(method, "toggleArrisRelease")) {
    if (args.size() != 1) {
      last_json = errorJson("toggleArrisRelease requires 1 arg");
      return last_json.c_str();
    }
    value = IRsend::toggleArrisRelease(args[0]);
  } else if (!std::strcmp(method, "encodeArris")) {
    if (args.size() != 2) {
      last_json = errorJson("encodeArris requires 2 args");
      return last_json.c_str();
    }
    value = IRsend::encodeArris(args[0], args[1] != 0);
  } else {
    last_json = errorJson("unsupported IRsend encoder");
    return last_json.c_str();
  }

  last_json = encodeResultJson(method, value);
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_method_json(const char *method, const char *args_csv) {
  if (method == nullptr) {
    last_json = errorJson("method is required");
    return last_json.c_str();
  }
  const char *arg_text = args_csv == nullptr ? "" : args_csv;
  const bool stateDefaultArgs = std::strncmp(arg_text, "state:", 6) == 0;
  const std::vector<uint64_t> args = stateDefaultArgs ? std::vector<uint64_t>() : parseWideNumbers(arg_text);
  const std::vector<uint8_t> stateDefaultData = stateDefaultArgs ? parseState(arg_text + 6) : std::vector<uint8_t>();
  timingList.clear();
  CapturingIRsend sender(0);

  if (!std::strcmp(method, "sendData")) {
    if (args.size() < 6 || args.size() > 7) {
      last_json = errorJson("sendData requires 6 or 7 args");
      return last_json.c_str();
    }
    if (args.size() == 6) {
      sender.sendData(args[0], args[1], args[2], args[3], args[4], args[5]);
    } else {
      sender.sendData(args[0], args[1], args[2], args[3], args[4], args[5], args[6] != 0);
    }
  } else if (!std::strcmp(method, "sendManchesterData")) {
    if (args.size() < 3 || args.size() > 5) {
      last_json = errorJson("sendManchesterData requires 3 to 5 args");
      return last_json.c_str();
    }
    if (args.size() == 3) {
      sender.sendManchesterData(args[0], args[1], args[2]);
    } else if (args.size() == 4) {
      sender.sendManchesterData(args[0], args[1], args[2], args[3] != 0);
    } else {
      sender.sendManchesterData(args[0], args[1], args[2], args[3] != 0, args[4] != 0);
    }
  } else if (!std::strcmp(method, "sendManchester")) {
    if (args.size() < 7 || args.size() > 12) {
      last_json = errorJson("sendManchester requires 7 to 12 args");
      return last_json.c_str();
    }
    if (args.size() == 7) {
      sender.sendManchester(args[0], args[1], args[2], args[3], args[4],
                             args[5], args[6]);
    } else if (args.size() == 8) {
      sender.sendManchester(args[0], args[1], args[2], args[3], args[4],
                             args[5], args[6], args[7]);
    } else if (args.size() == 9) {
      sender.sendManchester(args[0], args[1], args[2], args[3], args[4],
                             args[5], args[6], args[7], args[8] != 0);
    } else if (args.size() == 10) {
      sender.sendManchester(args[0], args[1], args[2], args[3], args[4],
                             args[5], args[6], args[7], args[8] != 0,
                             args[9]);
    } else if (args.size() == 11) {
      sender.sendManchester(args[0], args[1], args[2], args[3], args[4],
                             args[5], args[6], args[7], args[8] != 0,
                             args[9], args[10]);
    } else {
      sender.sendManchester(args[0], args[1], args[2], args[3], args[4],
                             args[5], args[6], args[7], args[8] != 0,
                             args[9], args[10], args[11] != 0);
    }
  } else if (!std::strcmp(method, "sendGeneric")) {
    if (args.size() != 14) {
      last_json = errorJson("sendGeneric requires 14 args");
      return last_json.c_str();
    }
    sender.sendGeneric(args[0], args[1], args[2], args[3], args[4], args[5],
                       args[6], args[7], args[8], args[9], args[10],
                       args[11] != 0, args[12], args[13]);
  } else if (!std::strcmp(method, "sendGenericMesgtime")) {
    if (args.size() != 15) {
      last_json = errorJson("sendGenericMesgtime requires 15 args");
      return last_json.c_str();
    }
    sender.sendGeneric(args[0], args[1], args[2], args[3], args[4], args[5],
                       args[6], args[7], args[8], args[9], args[10], args[11],
                       args[12] != 0, args[13], args[14]);
  } else if (!std::strcmp(method, "sendGenericBytes")) {
    if (args.size() < 13) {
      last_json = errorJson("sendGenericBytes requires at least 13 args");
      return last_json.c_str();
    }
    const uint16_t nbytes = args[8];
    if (args.size() != static_cast<size_t>(13 + nbytes)) {
      last_json = errorJson("sendGenericBytes byte count does not match args");
      return last_json.c_str();
    }
    std::vector<uint8_t> data;
    for (uint16_t i = 0; i < nbytes; i++) {
      data.push_back(static_cast<uint8_t>(args[13 + i] & 0xFF));
    }
    sender.sendGeneric(args[0], args[1], args[2], args[3], args[4], args[5],
                       args[6], args[7], data.data(), nbytes, args[9],
                       args[10] != 0, args[11], args[12]);
  } else if (!std::strcmp(method, "sendGC")) {
    std::vector<uint16_t> data;
    for (uint64_t arg : args) data.push_back(static_cast<uint16_t>(arg));
    sender.sendGC(data.data(), data.size());
  } else if (!std::strcmp(method, "sendPronto")) {
    if (args.size() < 2) {
      last_json = errorJson("sendPronto requires repeat followed by pronto words");
      return last_json.c_str();
    }
    const uint16_t repeat = args[0];
    std::vector<uint16_t> data;
    for (size_t i = 1; i < args.size(); i++) data.push_back(static_cast<uint16_t>(args[i]));
    sender.sendPronto(data.data(), data.size(), repeat);
  } else if (!std::strcmp(method, "sendGree")) {
    if (stateDefaultArgs) {
      if (stateDefaultData.empty()) {
        last_json = errorJson("sendGree state must not be empty");
        return last_json.c_str();
      }
      sender.sendGree(stateDefaultData.data());
    } else if (args.size() == 1) {
      sender.sendGree(static_cast<uint64_t>(args[0]));
    } else if (args.size() == 2) {
      sender.sendGree(static_cast<uint64_t>(args[0]), static_cast<uint16_t>(args[1]));
    } else if (args.size() == 3) {
      sender.sendGree(static_cast<uint64_t>(args[0]), static_cast<uint16_t>(args[1]),
                      static_cast<uint16_t>(args[2]));
    } else if (args.size() > 3) {
      const uint16_t nbytes = static_cast<uint16_t>(args[0]);
      const uint16_t repeat = static_cast<uint16_t>(args[1]);
      if (args.size() != static_cast<size_t>(2 + nbytes)) {
        last_json = errorJson("sendGree byte count does not match args");
        return last_json.c_str();
      }
      std::vector<uint8_t> data;
      for (uint16_t i = 0; i < nbytes; i++) data.push_back(static_cast<uint8_t>(args[2 + i] & 0xFF));
      sender.sendGree(data.data(), nbytes, repeat);
    } else {
      last_json = errorJson("sendGree requires either data, nbits, repeat or nbytes, repeat, and state bytes");
      return last_json.c_str();
    }
#define IR_VALUE_SEND_METHOD(name) \
  } else if (!std::strcmp(method, #name)) { \
    if (args.size() < 1 || args.size() > 3) { \
      last_json = errorJson(#name " requires 1 to 3 args"); \
      return last_json.c_str(); \
    } \
    if (args.size() == 1) { \
      sender.name(static_cast<uint64_t>(args[0])); \
    } else if (args.size() == 2) { \
      sender.name(static_cast<uint64_t>(args[0]), static_cast<uint16_t>(args[1])); \
    } else { \
      sender.name(static_cast<uint64_t>(args[0]), static_cast<uint16_t>(args[1]), \
                  static_cast<uint16_t>(args[2])); \
    }
  IR_VALUE_SEND_METHOD(sendNEC)
  IR_VALUE_SEND_METHOD(sendSony)
  IR_VALUE_SEND_METHOD(sendSony38)
  IR_VALUE_SEND_METHOD(sendSherwood)
  IR_VALUE_SEND_METHOD(sendSAMSUNG)
  IR_VALUE_SEND_METHOD(sendSamsung36)
  IR_VALUE_SEND_METHOD(sendLG)
  IR_VALUE_SEND_METHOD(sendLG2)
  IR_VALUE_SEND_METHOD(sendSharpRaw)
  IR_VALUE_SEND_METHOD(sendJVC)
  IR_VALUE_SEND_METHOD(sendDenon)
  IR_VALUE_SEND_METHOD(sendSanyoLC7461)
  IR_VALUE_SEND_METHOD(sendDISH)
  IR_VALUE_SEND_METHOD(sendPanasonic64)
  IR_VALUE_SEND_METHOD(sendRC5)
  IR_VALUE_SEND_METHOD(sendRC6)
  IR_VALUE_SEND_METHOD(sendRCMM)
  IR_VALUE_SEND_METHOD(sendCOOLIX)
  IR_VALUE_SEND_METHOD(sendCoolix48)
  IR_VALUE_SEND_METHOD(sendWhynter)
  IR_VALUE_SEND_METHOD(sendMitsubishi)
  IR_VALUE_SEND_METHOD(sendMitsubishi2)
  IR_VALUE_SEND_METHOD(sendInax)
  IR_VALUE_SEND_METHOD(sendDaikin64)
  IR_VALUE_SEND_METHOD(sendAiwaRCT501)
  IR_VALUE_SEND_METHOD(sendGoodweather)
  IR_VALUE_SEND_METHOD(sendGorenje)
  IR_VALUE_SEND_METHOD(sendNikai)
  IR_VALUE_SEND_METHOD(sendMidea)
  IR_VALUE_SEND_METHOD(sendMidea24)
  IR_VALUE_SEND_METHOD(sendMagiQuest)
  IR_VALUE_SEND_METHOD(sendLasertag)
  IR_VALUE_SEND_METHOD(sendCarrierAC)
  IR_VALUE_SEND_METHOD(sendCarrierAC40)
  IR_VALUE_SEND_METHOD(sendCarrierAC64)
  IR_VALUE_SEND_METHOD(sendGICable)
  IR_VALUE_SEND_METHOD(sendLutron)
  IR_VALUE_SEND_METHOD(sendPanasonicAC32)
  IR_VALUE_SEND_METHOD(sendPioneer)
  IR_VALUE_SEND_METHOD(sendVestelAc)
  IR_VALUE_SEND_METHOD(sendTeco)
  IR_VALUE_SEND_METHOD(sendLegoPf)
  IR_VALUE_SEND_METHOD(sendEpson)
  IR_VALUE_SEND_METHOD(sendSymphony)
  IR_VALUE_SEND_METHOD(sendAirwell)
  IR_VALUE_SEND_METHOD(sendDelonghiAc)
  IR_VALUE_SEND_METHOD(sendDoshisha)
  IR_VALUE_SEND_METHOD(sendMultibrackets)
  IR_VALUE_SEND_METHOD(sendTechnibelAc)
  IR_VALUE_SEND_METHOD(sendZepeal)
  IR_VALUE_SEND_METHOD(sendMetz)
  IR_VALUE_SEND_METHOD(sendTranscold)
  IR_VALUE_SEND_METHOD(sendElitescreens)
  IR_VALUE_SEND_METHOD(sendMilestag2)
  IR_VALUE_SEND_METHOD(sendEcoclim)
  IR_VALUE_SEND_METHOD(sendXmp)
  IR_VALUE_SEND_METHOD(sendTruma)
  IR_VALUE_SEND_METHOD(sendKelon)
  IR_VALUE_SEND_METHOD(sendBose)
  IR_VALUE_SEND_METHOD(sendArris)
  IR_VALUE_SEND_METHOD(sendAirton)
  IR_VALUE_SEND_METHOD(sendToto)
  IR_VALUE_SEND_METHOD(sendClimaButler)
  IR_VALUE_SEND_METHOD(sendWowwee)
#undef IR_VALUE_SEND_METHOD
#define IR_DEFAULT_STATE_SEND_METHOD(name) \
  } else if (!std::strcmp(method, #name)) { \
    if (stateDefaultArgs) { \
      if (stateDefaultData.empty()) { \
        last_json = errorJson(#name " state must not be empty"); \
        return last_json.c_str(); \
      } \
      sender.name(stateDefaultData.data()); \
    } else { \
      if (args.size() < 2) { \
        last_json = errorJson(#name " requires nbytes, repeat, and state bytes"); \
        return last_json.c_str(); \
      } \
      const uint16_t nbytes = static_cast<uint16_t>(args[0]); \
      const uint16_t repeat = static_cast<uint16_t>(args[1]); \
      if (args.size() != static_cast<size_t>(2 + nbytes)) { \
        last_json = errorJson(#name " byte count does not match args"); \
        return last_json.c_str(); \
      } \
      std::vector<uint8_t> data; \
      for (uint16_t i = 0; i < nbytes; i++) data.push_back(static_cast<uint8_t>(args[2 + i] & 0xFF)); \
      sender.name(data.data(), nbytes, repeat); \
    }
#define IR_REQUIRED_STATE_SEND_METHOD(name) \
  } else if (!std::strcmp(method, #name)) { \
    if (stateDefaultArgs) { \
      last_json = errorJson(#name " requires explicit nbytes"); \
      return last_json.c_str(); \
    } \
    if (args.size() < 2) { \
      last_json = errorJson(#name " requires nbytes, repeat, and state bytes"); \
      return last_json.c_str(); \
    } \
    const uint16_t nbytes = static_cast<uint16_t>(args[0]); \
    const uint16_t repeat = static_cast<uint16_t>(args[1]); \
    if (args.size() != static_cast<size_t>(2 + nbytes)) { \
      last_json = errorJson(#name " byte count does not match args"); \
      return last_json.c_str(); \
    } \
    std::vector<uint8_t> data; \
    for (uint16_t i = 0; i < nbytes; i++) data.push_back(static_cast<uint8_t>(args[2 + i] & 0xFF)); \
    sender.name(data.data(), nbytes, repeat);
  IR_DEFAULT_STATE_SEND_METHOD(sendMirage)
  IR_DEFAULT_STATE_SEND_METHOD(sendMitsubishi136)
  IR_DEFAULT_STATE_SEND_METHOD(sendMitsubishi112)
  IR_DEFAULT_STATE_SEND_METHOD(sendMitsubishiAC)
  IR_DEFAULT_STATE_SEND_METHOD(sendMitsubishiHeavy88)
  IR_DEFAULT_STATE_SEND_METHOD(sendMitsubishiHeavy152)
  IR_REQUIRED_STATE_SEND_METHOD(sendFujitsuAC)
  IR_DEFAULT_STATE_SEND_METHOD(sendKelvinator)
  IR_DEFAULT_STATE_SEND_METHOD(sendSamsungAC)
  IR_DEFAULT_STATE_SEND_METHOD(sendSharpAc)
  IR_DEFAULT_STATE_SEND_METHOD(sendSanyoAc)
  IR_DEFAULT_STATE_SEND_METHOD(sendSanyoAc88)
  IR_DEFAULT_STATE_SEND_METHOD(sendSanyoAc152)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin128)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin152)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin160)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin176)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin2)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin200)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin216)
  IR_DEFAULT_STATE_SEND_METHOD(sendDaikin312)
  IR_DEFAULT_STATE_SEND_METHOD(sendArgoWREM3)
  IR_DEFAULT_STATE_SEND_METHOD(sendTrotec)
  IR_DEFAULT_STATE_SEND_METHOD(sendTrotec3550)
  IR_DEFAULT_STATE_SEND_METHOD(sendToshibaAC)
  IR_DEFAULT_STATE_SEND_METHOD(sendCarrierAC84)
  IR_DEFAULT_STATE_SEND_METHOD(sendCarrierAC128)
  IR_DEFAULT_STATE_SEND_METHOD(sendHaierAC)
  IR_DEFAULT_STATE_SEND_METHOD(sendHaierACYRW02)
  IR_DEFAULT_STATE_SEND_METHOD(sendHaierAC160)
  IR_DEFAULT_STATE_SEND_METHOD(sendHaierAC176)
  IR_DEFAULT_STATE_SEND_METHOD(sendHitachiAC)
  IR_DEFAULT_STATE_SEND_METHOD(sendHitachiAC1)
  IR_DEFAULT_STATE_SEND_METHOD(sendHitachiAC2)
  IR_REQUIRED_STATE_SEND_METHOD(sendHitachiAc3)
  IR_DEFAULT_STATE_SEND_METHOD(sendHitachiAc264)
  IR_DEFAULT_STATE_SEND_METHOD(sendHitachiAc296)
  IR_DEFAULT_STATE_SEND_METHOD(sendHitachiAc344)
  IR_DEFAULT_STATE_SEND_METHOD(sendHitachiAc424)
  IR_DEFAULT_STATE_SEND_METHOD(sendWhirlpoolAC)
  IR_DEFAULT_STATE_SEND_METHOD(sendElectraAC)
  IR_DEFAULT_STATE_SEND_METHOD(sendPanasonicAC)
  IR_REQUIRED_STATE_SEND_METHOD(sendMWM)
  IR_DEFAULT_STATE_SEND_METHOD(sendTcl96Ac)
  IR_DEFAULT_STATE_SEND_METHOD(sendTcl112Ac)
  IR_DEFAULT_STATE_SEND_METHOD(sendNeoclima)
  IR_DEFAULT_STATE_SEND_METHOD(sendAmcor)
  IR_DEFAULT_STATE_SEND_METHOD(sendCoronaAc)
  IR_DEFAULT_STATE_SEND_METHOD(sendVoltas)
  IR_DEFAULT_STATE_SEND_METHOD(sendTeknopoint)
  IR_DEFAULT_STATE_SEND_METHOD(sendKelon168)
  IR_DEFAULT_STATE_SEND_METHOD(sendRhoss)
  IR_DEFAULT_STATE_SEND_METHOD(sendBosch144)
  IR_DEFAULT_STATE_SEND_METHOD(sendYork)
  IR_DEFAULT_STATE_SEND_METHOD(sendBluestarHeavy)
  IR_DEFAULT_STATE_SEND_METHOD(sendEurom)
#undef IR_DEFAULT_STATE_SEND_METHOD
#undef IR_REQUIRED_STATE_SEND_METHOD
  } else if (!std::strcmp(method, "sendArgo")) {
    if (stateDefaultArgs) {
      if (stateDefaultData.empty()) {
        last_json = errorJson("sendArgo state must not be empty");
        return last_json.c_str();
      }
      sender.sendArgo(stateDefaultData.data());
    } else if (args.size() < 3) {
      last_json = errorJson("sendArgo requires nbytes, repeat, sendFooter, and state bytes");
      return last_json.c_str();
    } else {
      const uint16_t nbytes = static_cast<uint16_t>(args[0]);
      const uint16_t repeat = static_cast<uint16_t>(args[1]);
      const bool sendFooter = args[2] != 0;
      if (args.size() != static_cast<size_t>(3 + nbytes)) {
        last_json = errorJson("sendArgo byte count does not match args");
        return last_json.c_str();
      }
      std::vector<uint8_t> data;
      for (uint16_t i = 0; i < nbytes; i++) data.push_back(static_cast<uint8_t>(args[3 + i] & 0xFF));
      sender.sendArgo(data.data(), nbytes, repeat, sendFooter);
    }
  } else if (!std::strcmp(method, "sendSharp")) {
    if (args.size() < 2 || args.size() > 4) {
      last_json = errorJson("sendSharp requires 2 to 4 args");
      return last_json.c_str();
    }
    if (args.size() == 2) {
      sender.sendSharp(args[0], args[1]);
    } else if (args.size() == 3) {
      sender.sendSharp(args[0], args[1], args[2]);
    } else {
      sender.sendSharp(args[0], args[1], args[2], args[3]);
    }
  } else if (!std::strcmp(method, "sendPanasonic")) {
    if (args.size() < 2 || args.size() > 4) {
      last_json = errorJson("sendPanasonic requires 2 to 4 args");
      return last_json.c_str();
    }
    if (args.size() == 2) {
      sender.sendPanasonic(args[0], args[1]);
    } else if (args.size() == 3) {
      sender.sendPanasonic(args[0], args[1], args[2]);
    } else {
      sender.sendPanasonic(args[0], args[1], args[2], args[3]);
    }
  } else if (!std::strcmp(method, "sendArgoSensorTemp")) {
    if (args.size() < 1 || args.size() > 2) {
      last_json = errorJson("sendArgoSensorTemp requires degrees and optional repeat");
      return last_json.c_str();
    }
    IRArgoAC ac(0);
    ac.sendSensorTemp(static_cast<uint8_t>(args[0]), args.size() == 2 ? static_cast<uint16_t>(args[1]) : kArgoDefaultRepeat);
  } else if (!std::strcmp(method, "sendArgoWrem3SensorTemp")) {
    if (args.size() < 1 || args.size() > 2) {
      last_json = errorJson("sendArgoWrem3SensorTemp requires degrees and optional repeat");
      return last_json.c_str();
    }
    IRArgoAC_WREM3 ac(0);
    ac.sendSensorTemp(static_cast<uint8_t>(args[0]), args.size() == 2 ? static_cast<uint16_t>(args[1]) : kArgoDefaultRepeat);
  } else if (!std::strcmp(method, "sendSamsungAcExtended")) {
    if (args.size() > 1) {
      last_json = errorJson("sendSamsungAcExtended requires optional repeat");
      return last_json.c_str();
    }
    IRSamsungAc ac(0);
    ac.sendExtended(args.empty() ? kSamsungAcDefaultRepeat : static_cast<uint16_t>(args[0]));
  } else if (!std::strcmp(method, "sendSamsungAcOn")) {
    if (args.size() > 1) {
      last_json = errorJson("sendSamsungAcOn requires optional repeat");
      return last_json.c_str();
    }
    IRSamsungAc ac(0);
    ac.sendOn(args.empty() ? kSamsungAcDefaultRepeat : static_cast<uint16_t>(args[0]));
  } else if (!std::strcmp(method, "sendSamsungAcOff")) {
    if (args.size() > 1) {
      last_json = errorJson("sendSamsungAcOff requires optional repeat");
      return last_json.c_str();
    }
    IRSamsungAc ac(0);
    ac.sendOff(args.empty() ? kSamsungAcDefaultRepeat : static_cast<uint16_t>(args[0]));
  } else {
    last_json = errorJson("unsupported IRsend method");
    return last_json.c_str();
  }

  last_json = generatedMethodJson(method, sender.frequency() > 0 ? sender.frequency() : 38000);
  return last_json.c_str();
}

IR_EXPORT
const char *ir_generate_ac_full_json(const char *protocol, int model, int power,
                                     const char *mode, int temperatureC,
                                     int celsius, const char *fan,
                                     int swingv, int swingh, int quiet,
                                     int turbo, int econo, int light,
                                     int filter, int clean, int beep,
                                     int sleep, int clock) {
  const decode_type_t type = strToDecodeType(protocol);
  if (type == UNKNOWN) {
    last_json = errorJson("unknown protocol");
    return last_json.c_str();
  }
  timingList.clear();
  IRac ac(0);
  if (!ac.sendAc(type, model, power, parseMode(mode), temperatureC, celsius != 0,
                 parseFan(fan), static_cast<stdAc::swingv_t>(swingv),
                 static_cast<stdAc::swingh_t>(swingh), quiet, turbo, econo,
                 light, filter, clean, beep, sleep, clock)) {
    last_json = errorJson("unsupported AC common generation for protocol");
    return last_json.c_str();
  }
  last_json = generatedJson("ac", type, IRsend::defaultBits(type), 0, 0);
  return last_json.c_str();
}

IR_EXPORT
const char *ir_infer_json(const char *raw_csv, int frequency) {
  const std::vector<uint32_t> raw = parseNumbers(raw_csv);
  if (raw.empty()) {
    last_json = "{\"matched\":false,\"rawLength\":0,\"raw_length\":0,\"frequency\":null}";
    return last_json.c_str();
  }

  std::vector<uint16_t> rawbuf(raw.size() + 1);
  rawbuf[0] = 0;
  for (size_t i = 0; i < raw.size(); i++) {
    rawbuf[i + 1] =
        static_cast<uint16_t>(std::min<uint32_t>(raw[i] / kRawTick, UINT16_MAX));
  }

  decode_results results;
  results.rawbuf = rawbuf.data();
  results.rawlen = rawbuf.size();
  results.overflow = false;
  results.repeat = false;
  results.decode_type = UNKNOWN;
  results.bits = 0;
  results.value = 0;
  results.address = 0;
  results.command = 0;

  IRrecv recv(0);
  if (!recv.decode(&results)) {
    std::ostringstream out;
    out << "{\"matched\":false,\"rawLength\":" << raw.size()
        << ",\"raw_length\":" << raw.size()
        << ",\"frequency\":"
        << (frequency > 0 ? std::to_string(frequency) : "null") << "}";
    last_json = out.str();
    return last_json.c_str();
  }

  last_json = inferJson(results, frequency > 0 ? frequency : 38000);
  return last_json.c_str();
}

}
