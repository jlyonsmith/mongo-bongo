"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BongoTool = undefined;

var _glob = require("glob");

var _minimist = require("minimist");

var _minimist2 = _interopRequireDefault(_minimist);

var _version = require("./version");

var _util = require("util");

var _util2 = _interopRequireDefault(_util);

var _fsExtra = require("fs-extra");

var _fsExtra2 = _interopRequireDefault(_fsExtra);

var _path = require("path");

var _path2 = _interopRequireDefault(_path);

var _os = require("os");

var _os2 = _interopRequireDefault(_os);

var _process = require("process");

var _process2 = _interopRequireDefault(_process);

var _child_process = require("child_process");

var _child_process2 = _interopRequireDefault(_child_process);

var _commandExists = require("command-exists");

var _json = require("json5");

var _json2 = _interopRequireDefault(_json);

var _randomatic = require("randomatic");

var _randomatic2 = _interopRequireDefault(_randomatic);

var _tmpPromise = require("tmp-promise");

var _tmpPromise2 = _interopRequireDefault(_tmpPromise);

var _moment = require("moment");

var _moment2 = _interopRequireDefault(_moment);

var _jsYaml = require("js-yaml");

var _jsYaml2 = _interopRequireDefault(_jsYaml);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class BongoTool {
  constructor(toolName, log) {
    this.toolName = toolName;
    this.log = log;
  }

  ensureCommands(cmds) {
    cmds.forEach(cmd => {
      if (!(0, _commandExists.sync)(cmd)) {
        throw new Error(`Command '${cmd}' does not exist.  Please install it.`);
      }
    });
  }

  static getPassword() {
    return (0, _randomatic2.default)("Aa0", 16);
  }

  static generateAdminPasswords(dbName) {
    return {
      root: BongoTool.getPassword(),
      backup: BongoTool.getPassword(),
      restore: BongoTool.getPassword()
    };
  }

  static generatePasswords() {
    return {
      admin: BongoTool.getPassword(),
      user: BongoTool.getPassword()
    };
  }

  async readCredentials() {
    let credentials = {};

    if (_fsExtra2.default.existsSync(BongoTool.credentialsFile)) {
      const json = await _fsExtra2.default.readFile(BongoTool.credentialsFile, {
        encoding: "utf8"
      });

      credentials = _json2.default.parse(json);
    }

    return credentials;
  }

  async writeCredentials(credentials) {
    const json = _json2.default.stringify(credentials, null, "  ");

    await _fsExtra2.default.writeFile(BongoTool.credentialsFile, json, { mode: 0o600 });
  }

  async users(dbName) {
    let credentials = await this.readCredentials();
    let result, tf, passwords;

    if (!credentials.admin) {
      this.log.error("No 'admin' database root user.  Run tool on 'admin' database first.");
      return;
    }

    let hasSecurity = false;

    try {
      result = await (0, _util.promisify)(_child_process2.default.exec)('mongo --eval "db.getUsers()"');
    } catch (error) {
      hasSecurity = true;
    }

    if (!hasSecurity) {
      this.log.error(`You must enable MongoDB security to set '${dbName}' database credentials`);
      return;
    }

    if (!credentials[dbName]) {
      passwords = BongoTool.generatePasswords();
      tf = await _tmpPromise2.default.file({ postfix: ".js" });

      await _fsExtra2.default.writeFile(tf.fd, `
db = db.getSiblingDB("${dbName}")
db.dropUser('admin')
db.createUser({user:"admin",pwd:"${passwords.admin}",roles:["readWrite", "dbAdmin", "userAdmin"]})
db.dropUser('user')
db.createUser({user:"user",pwd:"${passwords.user}",roles:["readWrite","dbAdmin"]})
quit()
`);

      try {
        result = await (0, _util.promisify)(_child_process2.default.exec)(`mongo -u root -p ${credentials.admin.root} --authenticationDatabase admin --quiet ${tf.path}`);
        this.log.info(result.stdout);
      } catch (error) {
        this.log.error(`Unable to create '${dbName}' database users`);
        return;
      } finally {
        tf.cleanup();
        tf = null;
      }

      credentials[dbName] = passwords;
      await this.writeCredentials(credentials);
      return;
    }

    tf = await _tmpPromise2.default.file({ postfix: ".js" });

    await _fsExtra2.default.writeFile(tf.fd, `
db = db.getSiblingDB("${dbName}")
assert(db.getUser("admin"))
assert(db.getUser("user"))
quit()
`);
    try {
      result = await (0, _util.promisify)(_child_process2.default.exec)(`mongo -u root -p ${credentials.admin.root} --authenticationDatabase admin --quiet ${tf.path}`);
      this.log.info(result.stdout);
    } catch (error) {
      this.log.error(`Unable to confirm existing '${dbName}' database users.`);
      return;
    } finally {
      tf.cleanup();
      tf = null;
    }

    if (!this.args["new-passwords"]) {
      this.log.info(`MongoDB '${dbName}' database users 'admin' & 'user' confirmed`);
      return;
    }

    passwords = BongoTool.generatePasswords();

    tf = await _tmpPromise2.default.file({ postfix: ".js" });

    await _fsExtra2.default.writeFile(tf.fd, `
db = db.getSiblingDB("${dbName}")
db.changeUserPassword("admin", "${passwords.admin}")
db.changeUserPassword("user", "${passwords.user}")
quit()
`);

    try {
      result = await (0, _util.promisify)(_child_process2.default.exec)(`mongo -u root -p ${credentials.admin.root} --authenticationDatabase admin --quiet ${tf.path}`);
    } catch (error) {
      this.log.error(`Unable to change '${dbName}' database user passwords.`);
      return;
    } finally {
      tf.cleanup();
      tf = null;
    }

    credentials[dbName] = passwords;
    await this.writeCredentials(credentials);

    this.log.info(`MongoDB '${dbName}' database user passwords changed`);
  }

  async usersAdmin() {
    let credentials = await this.readCredentials();
    let result, tf, passwords;

    try {
      result = await (0, _util.promisify)(_child_process2.default.exec)('mongo --eval "db.getUsers()" --quiet');
    } catch (error) {
      this.log.error("You must disable MongoDB security initialize the admin database");
      return;
    }

    if (!credentials.admin) {
      passwords = BongoTool.generateAdminPasswords();
      tf = await _tmpPromise2.default.file({ postfix: ".js" });

      await _fsExtra2.default.writeFile(tf.fd, `
db = db.getSiblingDB('admin')
db.dropUser('root')
db.createUser({user:"root",pwd:"${passwords.root}",roles:["userAdminAnyDatabase","readAnyDatabase","clusterAdmin"]})
db.dropUser('backup')
db.createUser({user:"backup",pwd:"${passwords.backup}",roles:["backup"]})
db.dropUser('restore')
db.createUser({user:"restore",pwd:"${passwords.restore}",roles:["restore"]})
quit()
`);
      try {
        result = await (0, _util.promisify)(_child_process2.default.exec)(`mongo ${tf.path} --quiet`);
        this.log.info(result.stdout);
      } catch (error) {
        this.log.error("Unable to create 'admin' database users");
        return;
      } finally {
        tf.cleanup();
        tf = null;
      }

      credentials.admin = passwords;
      await this.writeCredentials(credentials);
      return;
    }

    tf = await _tmpPromise2.default.file({ postfix: ".js" });

    await _fsExtra2.default.writeFile(tf.fd, `
db = db.getSiblingDB("admin")
assert(db.getUser("root"))
assert(db.getUser("backup"))
assert(db.getUser("restore"))
quit()
`);

    try {
      result = await (0, _util.promisify)(_child_process2.default.exec)(`mongo ${tf.path} --quiet`);
      this.log.info(result.stdout);
    } catch (error) {
      this.log.error("Unable to confirm existing 'admin' database users.");
      return;
    } finally {
      tf.cleanup();
      tf = null;
    }

    if (!this.args["new-passwords"]) {
      this.log.info("MongoDB 'admin' database users 'root', 'backup' & 'restore' confirmed");
      return;
    }

    passwords = BongoTool.generateAdminPasswords();

    tf = await _tmpPromise2.default.file({ postfix: ".js" });

    await _fsExtra2.default.writeFile(tf.fd, `
db = db.getSiblingDB("admin")
assert.eq(db, "admin")
db.changeUserPassword("root", "${passwords.root}")
db.changeUserPassword("backup", "${passwords.backup}")
db.changeUserPassword("restore", "${passwords.restore}")
quit()
`);
    try {
      result = await (0, _util.promisify)(_child_process2.default.exec)(`mongo ${tf.path} --quiet`);
    } catch (error) {
      this.log.error("Unable to change 'admin' database user passwords.");
      return;
    } finally {
      tf.cleanup();
      tf = null;
    }

    credentials.admin = passwords;
    await this.writeCredentials(credentials);

    this.log.info("MongoDB 'admin' database user passwords changed");
  }

  async backup(dbName) {
    const credentials = await this.readCredentials();
    const passwords = credentials.admin;
    const dateTime = (0, _moment2.default)().utc().format("YYYYMMDD-hhmmss") + "Z";
    const backupFile = `${dbName}-${dateTime}.archive`;

    try {
      const result = await (0, _util.promisify)(_child_process2.default.exec)(`mongodump --gzip --archive=${backupFile} --db ${dbName} -u backup -p ${passwords.backup} --authenticationDatabase=admin`);
      this.log.info(result.stdout);
    } catch (error) {
      this.log.error(`Unable to backup database '${dbName}'. ${error.message}`);
      return;
    }

    this.log.info(`MongoDB database '${dbName}' backed up to '${backupFile}'`);
  }

  async restore(dbName, backupFile) {
    const credentials = await this.readCredentials();
    const passwords = credentials.admin;

    try {
      const result = await (0, _util.promisify)(_child_process2.default.exec)(`mongorestore --gzip --archive=${backupFile} --drop --db ${dbName} -u restore -p ${passwords.restore} --authenticationDatabase=admin`);
      this.log.info(result.stdout);
    } catch (error) {
      this.log.error(`Unable to restore database '${dbName}'. ${error.message}`);
      return;
    }

    this.log.info(`MongoDB database '${dbName}' restored from '${backupFile}'`);
  }

  async mongo(auth, bindAll) {
    const platform = _os2.default.platform();
    const modifyMongoConf = async (mongoConfFile, auth, bindAll) => {
      let conf = _jsYaml2.default.safeLoad((await _fsExtra2.default.readFile(mongoConfFile, { encoding: "utf8" })));

      conf.security.authorization = auth ? "enabled" : "disabled";

      if (bindAll) {
        conf.net.bindAll = true;
      } else {
        conf.net.bindIp = "127.0.0.1";
      }

      const confYaml = _jsYaml2.default.safeDump(conf);

      await _fsExtra2.default.writeFile(mongoConfFile, confYaml);

      return confYaml;
    };

    this.log.info(`Attempting to ${auth ? "enable" : "disable"} security and bind to ${bindAll ? "all" : "localhost"} IP address${bindAll ? "es" : ""}`);

    if (platform === "linux") {
      if (_os2.default.userInfo().username !== "root") {
        this.log.error("Must run this command under sudo on Linux");
        return;
      }

      this.ensureCommands(["systemctl", "lsb_release"]);

      let result = null;

      try {
        result = await _child_process2.default.exec("lsb_release -a");
      } catch (error) {
        this.log.error(`Cannot determine Linux release. ${error.message}`);
        return;
      }

      if (!result.stdout.match(/Ubuntu 16\.04/)) {
        this.log.error("This release of Linux has not been tested");
        return;
      }

      modifyMongoConf("/etc/mongod.conf", auth, bindAll);

      try {
        result = await _child_process2.default.exec("systemctl restart mongod");
      } catch (error) {
        this.log.error(`Cannot restart 'mongod' service. ${error.message}`);
      }
    } else if (platform === "darwin") {
      this.ensureCommands(["brew"]);

      modifyMongoConf("/usr/local/etc/mongod.conf", auth, bindAll);

      try {
        await _child_process2.default.exec("brew restart mongodb");
      } catch (error) {
        this.log.error(`Unable to restart 'mongodb' service. ${error.message}`);
      }
    } else {
      this.log.error("This platform is not yet supported. Please consider submitting a PR!");
      return;
    }

    this.log.info("MongoDB restarted");
  }

  async run(argv) {
    const options = {
      boolean: ["help", "version", "new-passwords", "auth", "bind-all"]
    };
    this.args = (0, _minimist2.default)(argv, options);

    if (this.args.version) {
      this.log.info(`${_version.fullVersion}`);
      return 0;
    }

    let command = this.args._[0];

    command = command ? command.toLowerCase() : "help";

    await _fsExtra2.default.ensureDir(BongoTool.dir);
    this.ensureCommands(["mongo", "mongostat"]);

    switch (command) {
      case "users":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} users [db]

Description:

Ensures that the users 'admin' & 'user' exist on regular database, and 'root',
'backup' & 'restore' if the 'admin' database is specified.

Options:

-new-passwords   Generate new passwords for existing users.
`);
          return 0;
        }
        if (this.args._[1] === "admin") {
          await this.usersAdmin();
        } else {
          await this.users(this.args._[1]);
        }
        break;
      case "backup":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} backup <db>

Description:

Backs up all non-system collections in the given database creating a
timestamped .archive file.
`);
          return 0;
        }
        await this.backup(this.args._[1]);
        break;
      case "restore":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} restore <db> <archive>

Description:

Creates or overwrites the specified database with the given .archive file.
`);
          return 0;
        }
        await this.restore(this.args._[1], this.args._[2]);
        break;
      case "mongo":
        if (this.args.help) {
          this.log.info(`Usage: ${this.toolName} mongo [online|offline]

Description:

Brings the the MongoDB daemon online or offline to enable changes to the
the admin database 'root', 'backup' and 'restore' users.

Options:

--[no-]auth       Enabled/disable security for the MongoDB instance
--[no-]bind-all   Bind to all network interfaces or bind only to localhost
`);
          return 0;
        }
        await this.mongo(this.args.auth, this.args["bind-all"]);
        break;
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
`);
        return 0;
    }

    return 0;
  }
}
exports.BongoTool = BongoTool;
BongoTool.dir = _path2.default.join(_process2.default.env.HOME, ".bongo");
BongoTool.credentialsFile = _path2.default.join(BongoTool.dir, "credentials.json5");
//# sourceMappingURL=BongoTool.js.map