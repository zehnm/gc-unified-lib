# gc-unified-lib Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

_Changes in the next release_

---

## 0.1.0 - 2024-08-22

First release after forking from [tillbaks/node-itach](https://github.com/tillbaks/node-itach).

### Breaking changes
- Renamed module to `gc-unified-lib`.
- Rewritten message queue.
- Renew codebase with ES6 classes.
- Reset version to `0.1.0`. There might be more breaking changes in the future until functionality stabilizes for a v1 release.
- Update ava & sinon test framework which now require Node.js v18.18 or newer.

### Added
- Device discovery & product model information.
- Queue timeout until the message has to be sent, otherwise it expires.
- Automatic reconnect if connection drops once connected.
- TCP keepalive option.
- eslint and prettier configuration.
- GitHub actions for unit tests and code linting checks.

### Changed
- Handle error codes of non-iTach devices (GC-100, Flex and Global Connect).
- Socket reconnection using the `reconnecting-socket` module.
- Log output using the `debug` module.

### Fixed
- Handle socket response data in multiple data packages.
- Reconnection loop with checking socket state.
