import parseArgs from "minimist"
import { fullVersion } from "./version"
import fs from "fs-extra"
import path from "path"
import os from "os"
import process from "process"
import cp from "child_process"
import { sync as commandExistsSync } from "command-exists"
import JSON5 from "json5"
import randomize from "randomatic"
import tmp from "tmp-promise"
import { promisify } from "util"
import moment from "moment"
import yaml from "js-yaml"
import stream from "stream"

function streamToString(readable) {
  if (!(readable instanceof stream.Readable)) {
    return readable.toString()
  }

  return new Promise((resolve, reject) => {
    let string = ""

    readable.on("readable", (buffer) => {
      string += buffer.read().toString()
    })

    readable.on("end", () => {
      resolve(string)
    })

    readable.on("error", (error) => {
      reject(error)
    })

    readable.pipe(writeable)
  })
}

const execAsync = promisify(cp.exec)

export class BongoTool {
  constructor(toolName, log) {
    this.toolName = toolName
    this.log = log
  }

  static dir = path.join(process.env.HOME, ".bongo")
  static credentialsFile = path.join(BongoTool.dir, "credentials.json5")

  ensureCommands(cmds) {
    cmds.forEach((cmd) => {
      if (!commandExistsSync(cmd)) {
        throw new Error(`Command '${cmd}' does not exist.  Please install it.`)
      }
    })
  }

  static getPassword() {
    return randomize("Aa0", 16)
  }

  static generateAdminPasswords(dbName) {
    return {
      root: BongoTool.getPassword(),
      backup: BongoTool.getPassword(),
      restore: BongoTool.getPassword(),
    }
  }

  static generatePasswords() {
    return {
      admin: BongoTool.getPassword(),
      user: BongoTool.getPassword(),
    }
  }

  async readCredentials() {
    let credentials = {}

    if (fs.existsSync(BongoTool.credentialsFile)) {
      const json = await fs.readFile(BongoTool.credentialsFile, {
        encoding: "utf8",
      })

      credentials = JSON5.parse(json)
    }

    return credentials
  }

  async writeCredentials(credentials) {
    const json = JSON5.stringify(credentials, null, "  ")

    await fs.writeFile(BongoTool.credentialsFile, json, { mode: 0o600 })
  }

  async users(dbName) {
    let credentials = await this.readCredentials()
    let result, tf, passwords

    if (!credentials.admin) {
      this.log.error(
        "No 'admin' database root user.  Run tool on 'admin' database first."
      )
      return
    }

    this.log.info("Adding admin and user users to ${dbName} database")

    let hasSecurity = false

    try {
      result = await execAsync('mongo --eval "db.getUsers()"')
    } catch (error) {
      hasSecurity = true
    }

    if (!hasSecurity) {
      this.log.error(
        `You must enable MongoDB security to set '${dbName}' database credentials`
      )
      return
    }

    if (!credentials[dbName]) {
      passwords = BongoTool.generatePasswords()
      tf = await tmp.file({ postfix: ".js" })

      await fs.writeFile(
        tf.fd,
        `
db = db.getSiblingDB("${dbName}")
db.dropUser('admin')
db.createUser({user:"admin",pwd:"${
          passwords.admin
        }",roles:["readWrite", "dbAdmin", "userAdmin"]})
db.dropUser('user')
db.createUser({user:"user",pwd:"${
          passwords.user
        }",roles:["readWrite","dbAdmin"]})
quit()
`
      )

      try {
        result = await execAsync(
          `mongo -u root -p ${
            credentials.admin.root
          } --authenticationDatabase admin --quiet ${tf.path}`
        )
        this.log.info(await streamToString(result.stdout))
      } catch (error) {
        this.log.error(
          `Unable to create '${dbName}' database users. ${error.message}`
        )
        return
      } finally {
        tf.cleanup()
        tf = null
      }

      credentials[dbName] = passwords
      await this.writeCredentials(credentials)
      return
    }

    tf = await tmp.file({ postfix: ".js" })

    await fs.writeFile(
      tf.fd,
      `
db = db.getSiblingDB("${dbName}")
assert(db.getUser("admin"))
assert(db.getUser("user"))
quit()
`
    )
    try {
      result = await execAsync(
        `mongo -u root -p ${
          credentials.admin.root
        } --authenticationDatabase admin --quiet ${tf.path}`
      )
      this.log.info(await streamToString(result.stdout))
    } catch (error) {
      this.log.error(
        `Unable to confirm existing '${dbName}' database users. ${
          error.message
        }`
      )
      return
    } finally {
      tf.cleanup()
      tf = null
    }

    if (!this.args["new-passwords"]) {
      this.log.info(
        `MongoDB '${dbName}' database users 'admin' & 'user' confirmed`
      )
      return
    }

    passwords = BongoTool.generatePasswords()

    tf = await tmp.file({ postfix: ".js" })

    await fs.writeFile(
      tf.fd,
      `
db = db.getSiblingDB("${dbName}")
db.changeUserPassword("admin", "${passwords.admin}")
db.changeUserPassword("user", "${passwords.user}")
quit()
`
    )

    try {
      result = await execAsync(
        `mongo -u root -p ${
          credentials.admin.root
        } --authenticationDatabase admin --quiet ${tf.path}`
      )
    } catch (error) {
      this.log.error(`Unable to change '${dbName}' database user passwords.`)
      return
    } finally {
      tf.cleanup()
      tf = null
    }

    credentials[dbName] = passwords
    await this.writeCredentials(credentials)

    this.log.info(`MongoDB '${dbName}' database user passwords changed`)
  }

  async usersAdmin() {
    let credentials = await this.readCredentials()
    let result, tf, passwords

    this.log.info("Adding root, backup and restore user to admin database")

    try {
      result = await execAsync('mongo --eval "db.getUsers()" --quiet')
    } catch (error) {
      this.log.error(
        "You must disable MongoDB security initialize the admin database"
      )
      return
    }

    if (!credentials.admin) {
      passwords = BongoTool.generateAdminPasswords()
      tf = await tmp.file({ postfix: ".js" })

      await fs.writeFile(
        tf.fd,
        `
db = db.getSiblingDB('admin')
db.dropUser('root')
db.createUser({user:"root",pwd:"${
          passwords.root
        }",roles:["userAdminAnyDatabase","readAnyDatabase","clusterAdmin"]})
db.dropUser('backup')
db.createUser({user:"backup",pwd:"${passwords.backup}",roles:["backup"]})
db.dropUser('restore')
db.createUser({user:"restore",pwd:"${passwords.restore}",roles:["restore"]})
quit()
`
      )
      try {
        result = await execAsync(`mongo ${tf.path} --quiet`)
      } catch (error) {
        this.log.error(
          `Unable to create 'root' database users. ${error.message}`
        )
        return
      } finally {
        tf.cleanup()
        tf = null
      }

      this.log.info(await streamToString(result.stdout))

      credentials.admin = passwords
      await this.writeCredentials(credentials)
      return
    }

    tf = await tmp.file({ postfix: ".js" })

    await fs.writeFile(
      tf.fd,
      `
db = db.getSiblingDB("admin")
assert(db.getUser("root"))
assert(db.getUser("backup"))
assert(db.getUser("restore"))
quit()
`
    )

    try {
      result = await execAsync(`mongo ${tf.path} --quiet`)
    } catch (error) {
      this.log.error(
        `Unable to confirm existing 'admin' database users. ${error.message}`
      )
      return
    } finally {
      tf.cleanup()
      tf = null
    }

    this.log.info(await streamToString(result.stdout))

    if (!this.args["new-passwords"]) {
      this.log.info(
        "MongoDB 'admin' database users 'root', 'backup' & 'restore' confirmed"
      )
      return
    }

    passwords = BongoTool.generateAdminPasswords()

    tf = await tmp.file({ postfix: ".js" })

    await fs.writeFile(
      tf.fd,
      `
db = db.getSiblingDB("admin")
assert.eq(db, "admin")
db.changeUserPassword("root", "${passwords.root}")
db.changeUserPassword("backup", "${passwords.backup}")
db.changeUserPassword("restore", "${passwords.restore}")
quit()
`
    )
    try {
      result = await execAsync(`mongo ${tf.path} --quiet`)
    } catch (error) {
      this.log.error("Unable to change 'admin' database user passwords.")
      return
    } finally {
      tf.cleanup()
      tf = null
    }

    credentials.admin = passwords
    await this.writeCredentials(credentials)

    this.log.info("MongoDB 'admin' database user passwords changed")
  }

  async backup(dbName) {
    const credentials = await this.readCredentials()
    const passwords = credentials.admin
    const dateTime =
      moment()
        .utc()
        .format("YYYYMMDD-hhmmss") + "Z"
    const backupFile = `${dbName}-${dateTime}.archive`

    try {
      const result = await execAsync(
        `mongodump --gzip --archive=${backupFile} --db ${dbName} -u backup -p ${
          passwords.backup
        } --authenticationDatabase=admin`
      )
      this.log.info(await streamToString(result.stdout))
    } catch (error) {
      this.log.error(`Unable to backup database '${dbName}'. ${error.message}`)
      return
    }

    this.log.info(`MongoDB database '${dbName}' backed up to '${backupFile}'`)
  }

  async restore(dbName, backupFile) {
    const credentials = await this.readCredentials()
    const passwords = credentials.admin

    try {
      const result = await execAsync(
        `mongorestore --gzip --archive=${backupFile} --drop --db ${dbName} -u restore -p ${
          passwords.restore
        } --authenticationDatabase=admin`
      )
      this.log.info(await streamToString(result.stdout))
    } catch (error) {
      this.log.error(`Unable to restore database '${dbName}'. ${error.message}`)
      return
    }

    this.log.info(`MongoDB database '${dbName}' restored from '${backupFile}'`)
  }

  async mongo(auth, bindAll) {
    const platform = os.platform()
    const modifyMongoConf = async (mongoConfFile, auth, bindAll) => {
      let conf = yaml.safeLoad(
        await fs.readFile(mongoConfFile, { encoding: "utf8" })
      )

      conf.security.authorization = auth ? "enabled" : "disabled"

      if (bindAll) {
        conf.net.bindAll = true
      } else {
        conf.net.bindIp = "127.0.0.1"
      }

      const confYaml = yaml.safeDump(conf)

      await fs.writeFile(mongoConfFile, confYaml)

      return confYaml
    }

    this.log.info(
      `Attempting to ${auth ? "enable" : "disable"} security and bind to ${
        bindAll ? "all" : "localhost"
      } IP address${bindAll ? "es" : ""}`
    )

    if (platform === "linux") {
      if (os.userInfo().username !== "root") {
        this.log.error("Must run this command under sudo on Linux")
        return
      }

      this.ensureCommands(["systemctl", "lsb_release"])

      let result = null

      try {
        result = await cp.exec("lsb_release -a")
      } catch (error) {
        this.log.error(`Cannot determine Linux release. ${error.message}`)
        return
      }

      if (!(await streamToString(result.stdout)).match(/Ubuntu 1(6|8)\./)) {
        this.log.warning("This release of Linux has not been tested")
      }

      modifyMongoConf("/etc/mongod.conf", auth, bindAll)

      try {
        result = await cp.exec("systemctl restart mongod")
      } catch (error) {
        this.log.error(`Cannot restart 'mongod' service. ${error.message}`)
      }
    } else if (platform === "darwin") {
      this.ensureCommands(["brew"])

      modifyMongoConf("/usr/local/etc/mongod.conf", auth, bindAll)

      try {
        await cp.exec("brew services restart mongodb")
      } catch (error) {
        this.log.error(`Unable to restart 'mongodb' service. ${error.message}`)
      }
    } else {
      this.log.error(
        "This platform is not yet supported. Please consider submitting a PR!"
      )
      return
    }

    this.log.info("MongoDB restarted")
  }

  async run(argv) {
    const options = {
      boolean: ["help", "version", "new-passwords", "auth", "bind-all"],
    }
    this.args = parseArgs(argv, options)

    if (this.args.version) {
      this.log.info(`${fullVersion}`)
      return 0
    }

    let command = this.args._[0]

    command = command ? command.toLowerCase() : "help"

    await fs.ensureDir(BongoTool.dir)
    this.ensureCommands(["mongo", "mongostat"])

    switch (command) {
      case "users":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} users [db]

Description:

Ensures that the users 'admin' & 'user' exist on regular database, and 'root',
'backup' & 'restore' if the 'admin' database is specified.

Options:

  --new-passwords   Generate new passwords for existing users.
`)
          return 0
        }
        if (this.args._[1] === "admin") {
          await this.usersAdmin()
        } else {
          await this.users(this.args._[1])
        }
        break
      case "backup":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} backup <db>

Description:

Backs up all non-system collections in the given database creating a
timestamped .archive file.
`)
          return 0
        }
        await this.backup(this.args._[1])
        break
      case "restore":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} restore <db> <archive>

Description:

Creates or overwrites the specified database with the given .archive file.
`)
          return 0
        }
        await this.restore(this.args._[1], this.args._[2])
        break
      case "mongo":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} mongo [online|offline]

Description:

Brings the the MongoDB daemon online or offline to enable changes to the
the admin database 'root', 'backup' and 'restore' users.

Options:

--[no-]auth       Enabled/disable security for the MongoDB instance
--[no-]bind-all   Bind to all network interfaces or bind only to localhost
`)
          return 0
        }
        await this.mongo(this.args.auth, this.args["bind-all"])
        break
      case "help":
      default:
        this.log.info(`
Usage: ${this.toolName} <cmd> [options]

Description:

Opinionated MongoDB management tool. Ensures correct users and passwords
for databases and stores them in a credentials file. Generates and
restores backups archives using stored credentials.

Commands:
  users      Ensures that appropriate users and passwords exist
             for a database.
  backup     Create a timestamped backup of a database.
  restore    Restore a database backup.
  mongo      Take MongoDB service offline or online.

Global Options:
  --help                        Shows this help.
  --version                     Shows the tool version.
`)
        return 0
    }

    return 0
  }
}
