#!/usr/bin/env node
import { BongoTool } from "./BongoTool"
import chalk from "chalk"
import path from "path"

const log = {
  info: console.error,
  info2: function() {
    console.error(chalk.green([...arguments].join(" ")))
  },
  error: function() {
    console.error(chalk.red("error:", [...arguments].join(" ")))
  },
  warning: function() {
    console.error(chalk.yellow("warning:", [...arguments].join(" ")))
  },
}

const tool = new BongoTool(path.basename(process.argv[1], ".js"), log)

tool
  .run(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode
  })
  .catch((err) => {
    if (tool.debug) {
      console.error(err)
    }

    log.info(err.message)
  })
