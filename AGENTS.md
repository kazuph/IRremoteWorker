# Agent Guidelines

- Never open or send pull requests to the upstream IRremoteESP8266 repository.
- This repository is the production target for the Cloudflare Worker port.
- Do not reduce protocol coverage for speed. Keep inference and generation backed by the original C++ compiled to WASM.
- Deploy meaningful Worker changes with `npm run deploy` after local verification. The deploy script sources `../.envrc`.
