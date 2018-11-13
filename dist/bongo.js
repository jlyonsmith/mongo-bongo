#!/usr/bin/env node
"use strict";

var _BongoTool = require("./BongoTool");

var _chalk = _interopRequireDefault(require("chalk"));

var _path = _interopRequireDefault(require("path"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const log = {
  info: console.error,
  info2: function () {
    console.error(_chalk.default.green([...arguments].join(" ")));
  },
  error: function () {
    console.error(_chalk.default.red("error:", [...arguments].join(" ")));
  },
  warning: function () {
    console.error(_chalk.default.yellow("warning:", [...arguments].join(" ")));
  }
};
const tool = new _BongoTool.BongoTool(_path.default.basename(process.argv[1], ".js"), log);
tool.run(process.argv.slice(2)).then(exitCode => {
  process.exitCode = exitCode;
}).catch(err => {
  console.error(err);
});
//# sourceMappingURL=bongo.js.map