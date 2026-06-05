#include <iostream>
#include <string>

extern "C" const char *ir_generate_value_json(const char *protocol, const char *data,
                                               int bits, int repeat);
extern "C" const char *ir_generate_state_json(const char *protocol, const char *state_csv,
                                               int nbytes);
extern "C" const char *ir_generate_raw_json(const char *raw_csv, int frequency);
extern "C" const char *ir_generate_method_json(const char *method, const char *args_csv);
extern "C" const char *ir_encode_json(const char *method, const char *args_csv);
extern "C" const char *ir_generate_class_json(const char *className, const char *state_csv,
                                               const char *raw_value, int repeat);
extern "C" const char *ir_generate_class_method_json(const char *className, const char *state_csv,
                                                      const char *raw_value, const char *methodName,
                                                      const char *args_csv);
extern "C" const char *ir_generate_class_static_json(const char *className, const char *state_csv, const char *methodName,
                                                      const char *args_csv);
extern "C" const char *ir_generate_class_common_json(const char *className, const char *state_csv,
                                                      const char *raw_value);
extern "C" const char *ir_generate_class_string_json(const char *className, const char *state_csv,
                                                      const char *raw_value);
extern "C" const char *ir_generate_class_from_common_json(
    const char *className, int model, int power, const char *mode,
    int temperatureC, int celsius, const char *fan, int swingv, int swingh,
    int quiet, int turbo, int econo, int light, int filter, int clean, int beep,
    int sleep, int clock, int ifeel, int sensorTemperature, int repeat);
extern "C" const char *ir_generate_ac_full_json(const char *protocol, int model, int power,
                                                 const char *mode, int temperatureC,
                                                 int celsius, const char *fan,
                                                 int swingv, int swingh, int quiet,
                                                 int turbo, int econo, int light,
                                                 int filter, int clean, int beep,
                                                 int sleep, int clock);
extern "C" const char *ir_infer_json(const char *raw_csv, int frequency);
extern "C" const char *ir_protocols_json();

int parseBoolArg(const char *value) {
  const std::string text(value);
  return text == "true" || text == "1" ? 1 : 0;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    std::cerr << "usage: ir_native_oracle protocols\n"
              << "       ir_native_oracle ac-full <protocol> <model> <power:true|false> <mode> <temperatureC> <celsius:0|1> <fan> <swingv> <swingh> <quiet> <turbo> <econo> <light> <filter> <clean> <beep> <sleep> <clock>\n"
              << "       ir_native_oracle value <protocol> <data> <bits> <repeat>\n"
              << "       ir_native_oracle state <protocol> <state_csv> <nbytes>\n"
              << "       ir_native_oracle raw <raw_csv> <frequency>\n"
              << "       ir_native_oracle method <method> <args_csv>\n"
              << "       ir_native_oracle encode <method> <args_csv>\n"
              << "       ir_native_oracle class <className> <state_csv> <raw_value> <repeat>\n"
              << "       ir_native_oracle class-method <className> <state_csv> <raw_value> <method> <args_csv>\n"
              << "       ir_native_oracle class-static <className> <state_csv> <method> <args_csv>\n"
              << "       ir_native_oracle class-common <className> <state_csv> <raw_value>\n"
              << "       ir_native_oracle class-string <className> <state_csv> <raw_value>\n"
              << "       ir_native_oracle class-from-common <className> <model> <power:true|false> <mode> <temperatureC> <celsius:0|1> <fan> <swingv> <swingh> <quiet> <turbo> <econo> <light> <filter> <clean> <beep> <sleep> <clock> <iFeel> <sensorTemperature> <repeat>\n"
              << "       ir_native_oracle infer <raw_csv> <frequency>" << std::endl;
    return 64;
  }

  const std::string command = argv[1];
  if (command == "protocols") {
    std::cout << ir_protocols_json() << std::endl;
    return 0;
  }

  if (command == "ac-full") {
    if (argc != 20) {
      std::cerr << "usage: ir_native_oracle ac-full <protocol> <model> <power:true|false> <mode> <temperatureC> <celsius:0|1> <fan> <swingv> <swingh> <quiet> <turbo> <econo> <light> <filter> <clean> <beep> <sleep> <clock>"
                << std::endl;
      return 64;
    }
    const int power = parseBoolArg(argv[4]);
    std::cout << ir_generate_ac_full_json(
        argv[2], std::stoi(argv[3]), power, argv[5], std::stoi(argv[6]),
        std::stoi(argv[7]), argv[8], std::stoi(argv[9]), std::stoi(argv[10]),
        std::stoi(argv[11]), std::stoi(argv[12]), std::stoi(argv[13]),
        std::stoi(argv[14]), std::stoi(argv[15]), std::stoi(argv[16]),
        std::stoi(argv[17]), std::stoi(argv[18]), std::stoi(argv[19]))
              << std::endl;
    return 0;
  }

  if (command == "value") {
    if (argc != 6) {
      std::cerr << "usage: ir_native_oracle value <protocol> <data> <bits> <repeat>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_value_json(argv[2], argv[3], std::stoi(argv[4]), std::stoi(argv[5]))
              << std::endl;
    return 0;
  }

  if (command == "state") {
    if (argc != 5) {
      std::cerr << "usage: ir_native_oracle state <protocol> <state_csv> <nbytes>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_state_json(argv[2], argv[3], std::stoi(argv[4])) << std::endl;
    return 0;
  }

  if (command == "raw") {
    if (argc != 4) {
      std::cerr << "usage: ir_native_oracle raw <raw_csv> <frequency>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_raw_json(argv[2], std::stoi(argv[3])) << std::endl;
    return 0;
  }

  if (command == "method") {
    if (argc != 4) {
      std::cerr << "usage: ir_native_oracle method <method> <args_csv>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_method_json(argv[2], argv[3]) << std::endl;
    return 0;
  }

  if (command == "encode") {
    if (argc != 4) {
      std::cerr << "usage: ir_native_oracle encode <method> <args_csv>" << std::endl;
      return 64;
    }
    std::cout << ir_encode_json(argv[2], argv[3]) << std::endl;
    return 0;
  }

  if (command == "class") {
    if (argc != 6) {
      std::cerr << "usage: ir_native_oracle class <className> <state_csv> <raw_value> <repeat>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_class_json(argv[2], argv[3], argv[4], std::stoi(argv[5]))
              << std::endl;
    return 0;
  }

  if (command == "class-method") {
    if (argc != 7) {
      std::cerr << "usage: ir_native_oracle class-method <className> <state_csv> <raw_value> <method> <args_csv>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_class_method_json(argv[2], argv[3], argv[4], argv[5], argv[6])
              << std::endl;
    return 0;
  }

  if (command == "class-static") {
    if (argc != 6) {
      std::cerr << "usage: ir_native_oracle class-static <className> <state_csv> <method> <args_csv>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_class_static_json(argv[2], argv[3], argv[4], argv[5]) << std::endl;
    return 0;
  }

  if (command == "class-common") {
    if (argc != 5) {
      std::cerr << "usage: ir_native_oracle class-common <className> <state_csv> <raw_value>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_class_common_json(argv[2], argv[3], argv[4]) << std::endl;
    return 0;
  }

  if (command == "class-string") {
    if (argc != 5) {
      std::cerr << "usage: ir_native_oracle class-string <className> <state_csv> <raw_value>" << std::endl;
      return 64;
    }
    std::cout << ir_generate_class_string_json(argv[2], argv[3], argv[4]) << std::endl;
    return 0;
  }

  if (command == "class-from-common") {
    if (argc != 23) {
      std::cerr << "usage: ir_native_oracle class-from-common <className> <model> <power:true|false> <mode> <temperatureC> <celsius:0|1> <fan> <swingv> <swingh> <quiet> <turbo> <econo> <light> <filter> <clean> <beep> <sleep> <clock> <iFeel> <sensorTemperature> <repeat>"
                << std::endl;
      return 64;
    }
    std::cout << ir_generate_class_from_common_json(
                     argv[2], std::stoi(argv[3]), parseBoolArg(argv[4]),
                     argv[5], std::stoi(argv[6]), std::stoi(argv[7]), argv[8],
                     std::stoi(argv[9]), std::stoi(argv[10]),
                     std::stoi(argv[11]), std::stoi(argv[12]),
                     std::stoi(argv[13]), std::stoi(argv[14]),
                     std::stoi(argv[15]), std::stoi(argv[16]),
                     std::stoi(argv[17]), std::stoi(argv[18]),
                     std::stoi(argv[19]), std::stoi(argv[20]),
                     std::stoi(argv[21]), std::stoi(argv[22]))
              << std::endl;
    return 0;
  }

  if (command == "infer") {
    if (argc != 4) {
      std::cerr << "usage: ir_native_oracle infer <raw_csv> <frequency>" << std::endl;
      return 64;
    }
    std::cout << ir_infer_json(argv[2], std::stoi(argv[3])) << std::endl;
    return 0;
  }

  std::cerr << "unknown command: " << command << std::endl;
  return 64;
}
