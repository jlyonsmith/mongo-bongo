"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BongoTool = void 0;

var _minimist = _interopRequireDefault(require("minimist"));

var _version = require("./version");

var _fsExtra = _interopRequireDefault(require("fs-extra"));

var _path = _interopRequireDefault(require("path"));

var _os = _interopRequireDefault(require("os"));

var _process = _interopRequireDefault(require("process"));

var _child_process = _interopRequireDefault(require("child_process"));

var _commandExists = require("command-exists");

var _json = _interopRequireDefault(require("json5"));

var _randomatic = _interopRequireDefault(require("randomatic"));

var _tmpPromise = _interopRequireDefault(require("tmp-promise"));

var _util = require("util");

var _moment = _interopRequireDefault(require("moment"));

var _jsYaml = _interopRequireDefault(require("js-yaml"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const execAsync = (0, _util.promisify)(_child_process.default.exec);

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
    return (0, _randomatic.default)("Aa0", 16);
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

    if (_fsExtra.default.existsSync(BongoTool.credentialsFile)) {
      const json = await _fsExtra.default.readFile(BongoTool.credentialsFile, {
        encoding: "utf8"
      });
      credentials = _json.default.parse(json);
    }

    return credentials;
  }

  async writeCredentials(credentials) {
    const json = _json.default.stringify(credentials, null, "  ");

    await _fsExtra.default.writeFile(BongoTool.credentialsFile, json, {
      mode: 0o600
    });
  }

  async users(dbName, newPassword) {
    let credentials = await this.readCredentials();
    let result, tf, passwords;

    if (!credentials.admin) {
      this.log.error("No 'admin' database root user.  Run tool on 'admin' database first.");
      return;
    }

    this.log.info("Adding admin and user users to ${dbName} database");
    let hasSecurity = false;

    try {
      result = await execAsync('mongo --eval "db.getUsers()"');
    } catch (error) {
      hasSecurity = true;
    }

    if (!hasSecurity) {
      this.log.error(`You must enable MongoDB security to set '${dbName}' database credentials`);
      return;
    }

    if (!credentials[dbName]) {
      passwords = BongoTool.generatePasswords();
      tf = await _tmpPromise.default.file({
        postfix: ".js"
      });
      await _fsExtra.default.writeFile(tf.fd, `
db = db.getSiblingDB("${dbName}")
db.dropUser('admin')
db.createUser({user:"admin",pwd:"${passwords.admin}",roles:["readWrite", "dbAdmin", "userAdmin"]})
db.dropUser('user')
db.createUser({user:"user",pwd:"${passwords.user}",roles:["readWrite","dbAdmin"]})
quit()
`);

      try {
        result = await execAsync(`mongo -u root -p ${credentials.admin.root} --authenticationDatabase admin --quiet ${tf.path}`);
        this.log.info(result.stdout);
      } catch (error) {
        this.log.error(`Unable to create '${dbName}' database users. ${error.message}`);
        return;
      } finally {
        tf.cleanup();
        tf = null;
      }

      credentials[dbName] = passwords;
      await this.writeCredentials(credentials);
      return;
    }

    tf = await _tmpPromise.default.file({
      postfix: ".js"
    });
    await _fsExtra.default.writeFile(tf.fd, `
db = db.getSiblingDB("${dbName}")
assert(db.getUser("admin"))
assert(db.getUser("user"))
quit()
`);

    try {
      result = await execAsync(`mongo -u root -p ${credentials.admin.root} --authenticationDatabase admin --quiet ${tf.path}`);
      this.log.info(result.stdout);
    } catch (error) {
      this.log.error(`Unable to confirm existing '${dbName}' database users. ${error.message}`);
      return;
    } finally {
      tf.cleanup();
      tf = null;
    }

    if (!newPassword) {
      this.log.info(`MongoDB '${dbName}' database users 'admin' & 'user' confirmed`);
      return;
    }

    passwords = BongoTool.generatePasswords();
    tf = await _tmpPromise.default.file({
      postfix: ".js"
    });
    await _fsExtra.default.writeFile(tf.fd, `
db = db.getSiblingDB("${dbName}")
db.changeUserPassword("admin", "${passwords.admin}")
db.changeUserPassword("user", "${passwords.user}")
quit()
`);

    try {
      result = await execAsync(`mongo -u root -p ${credentials.admin.root} --authenticationDatabase admin --quiet ${tf.path}`);
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

  async usersAdmin(newPassword) {
    let credentials = await this.readCredentials();
    let result, tf, passwords;
    this.log.info("Adding root, backup and restore user to admin database");

    try {
      result = await execAsync('mongo --eval "db.getUsers()" --quiet');
    } catch (error) {
      this.log.error("You must disable MongoDB security initialize the admin database");
      return;
    }

    if (!credentials.admin) {
      passwords = BongoTool.generateAdminPasswords();
      tf = await _tmpPromise.default.file({
        postfix: ".js"
      });
      await _fsExtra.default.writeFile(tf.fd, `
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
        result = await execAsync(`mongo ${tf.path} --quiet`);
      } catch (error) {
        this.log.error(`Unable to create 'root' database users. ${error.message}`);
        return;
      } finally {
        tf.cleanup();
        tf = null;
      }

      this.log.info(result.stdout);
      credentials.admin = passwords;
      await this.writeCredentials(credentials);
      return;
    }

    tf = await _tmpPromise.default.file({
      postfix: ".js"
    });
    await _fsExtra.default.writeFile(tf.fd, `
db = db.getSiblingDB("admin")
assert(db.getUser("root"))
assert(db.getUser("backup"))
assert(db.getUser("restore"))
quit()
`);

    try {
      result = await execAsync(`mongo ${tf.path} --quiet`);
    } catch (error) {
      this.log.error(`Unable to confirm existing 'admin' database users. ${error.message}`);
      return;
    } finally {
      tf.cleanup();
      tf = null;
    }

    this.log.info(result.stdout);

    if (!newPassword) {
      this.log.info("MongoDB 'admin' database users 'root', 'backup' & 'restore' confirmed");
      return;
    }

    passwords = BongoTool.generateAdminPasswords();
    tf = await _tmpPromise.default.file({
      postfix: ".js"
    });
    await _fsExtra.default.writeFile(tf.fd, `
db = db.getSiblingDB("admin")
assert.eq(db, "admin")
db.changeUserPassword("root", "${passwords.root}")
db.changeUserPassword("backup", "${passwords.backup}")
db.changeUserPassword("restore", "${passwords.restore}")
quit()
`);

    try {
      result = await execAsync(`mongo ${tf.path} --quiet`);
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

  async backup(dbName, hostPort, newDbName, outputPath) {
    const credentials = await this.readCredentials();
    const passwords = credentials.admin;
    const dateTime = (0, _moment.default)().utc().format("YYYYMMDD-hhmmss") + "Z";
    const backupFile = `${newDbName || dbName}-${dateTime}.tar.gz`;
    hostPort = parseInt(hostPort) || 27017;
    outputPath = outputPath || _process.default.cwd();

    if (!_fsExtra.default.lstatSync(outputPath).isDirectory()) {
      throw new Error(`Output directory '${outputPath}' does not exist`);
    }

    this.ensureCommands(["mongodump", "tar"]);
    const tmpObj = await _tmpPromise.default.dir({
      unsafeCleanup: true
    });

    const dumpDir = _path.default.join(tmpObj.path, "dump");

    try {
      let cmd = null;

      if (credentials.backup) {
        cmd = `mongodump --port ${hostPort} --out ${tmpObj.path} --db ${dbName} -u backup -p ${passwords.backup} --authenticationDatabase=admin`;
      } else {
        cmd = `mongodump --port ${hostPort} --out ${dumpDir} --db ${dbName}`;
      }

      let result = await execAsync(cmd);
      this.log.info(result.stderr);

      if (newDbName) {
        // Rename the database directory
        this.log.info(`Renaming database to '${newDbName}'`);
        await _fsExtra.default.rename(_path.default.join(dumpDir, dbName), _path.default.join(dumpDir, newDbName));
        dbName = newDbName;
      }

      result = await execAsync(`tar -czvf ${backupFile} dump/*`, {
        cwd: tmpObj.path
      });
      await _fsExtra.default.move(_path.default.join(tmpObj.path, backupFile), _path.default.join(outputPath, backupFile));
    } catch (error) {
      this.log.error(`Unable to backup database '${dbName}'. ${error.message}`);
      return;
    } finally {
      if (tmpObj) {
        tmpObj.cleanup();
      }
    }

    this.log.info(`MongoDB database '${dbName}' backed up to '${backupFile}'`);
  }

  async restore(archiveFilename, hostPort) {
    const credentials = await this.readCredentials();
    const passwords = credentials.admin;
    this.ensureCommands(["mongorestore", "tar"]);
    archiveFilename = _path.default.resolve(archiveFilename);
    hostPort = parseInt(hostPort) || 27017;
    const tmpObj = await _tmpPromise.default.dir({
      unsafeCleanup: true
    });

    try {
      let result = await execAsync(`tar -x -f ${archiveFilename}`, {
        cwd: tmpObj.path
      });
      let cmd = null;

      if (credentials.restore) {
        cmd = `mongorestore --port ${hostPort} --drop -u restore -p ${passwords.restore} --authenticationDatabase=admin dump/`;
      } else {
        cmd = `mongorestore --port ${hostPort} --drop dump/`;
      }

      result = await execAsync(cmd, {
        cwd: tmpObj.path
      });
      this.log.info(result.stdout);
    } catch (error) {
      this.log.error(`Unable to restore archive file '${archiveFilename}'. ${error.message}`);
      return;
    } finally {
      if (tmpObj) {
        tmpObj.cleanup();
      }
    }

    this.log.info(`MongoDB database(s) restored from '${archiveFilename}'`);
  }

  async mongo(auth, bindAll) {
    const platform = _os.default.platform();

    const modifyMongoConf = async (mongoConfFile, auth, bindAll) => {
      let conf = _jsYaml.default.safeLoad((await _fsExtra.default.readFile(mongoConfFile, {
        encoding: "utf8"
      })));

      conf.security.authorization = auth ? "enabled" : "disabled";

      if (bindAll) {
        conf.net.bindAll = true;
      } else {
        conf.net.bindIp = "127.0.0.1";
      }

      const confYaml = _jsYaml.default.safeDump(conf);

      await _fsExtra.default.writeFile(mongoConfFile, confYaml);
      return confYaml;
    };

    this.log.info(`Attempting to ${auth ? "enable" : "disable"} security and bind to ${bindAll ? "all" : "localhost"} IP address${bindAll ? "es" : ""}`);

    if (platform === "linux") {
      if (_os.default.userInfo().username !== "root") {
        this.log.error("Must run this command under sudo on Linux");
        return;
      }

      this.ensureCommands(["systemctl", "lsb_release"]);
      let result = null;

      try {
        result = await _child_process.default.exec("lsb_release -a");
      } catch (error) {
        this.log.error(`Cannot determine Linux release. ${error.message}`);
        return;
      }

      if (!result.stdout.match(/Ubuntu 1(6|8)\./)) {
        this.log.warning("This release of Linux has not been tested");
      }

      modifyMongoConf("/etc/mongod.conf", auth, bindAll);

      try {
        result = await _child_process.default.exec("systemctl restart mongod");
      } catch (error) {
        this.log.error(`Cannot restart 'mongod' service. ${error.message}`);
      }
    } else if (platform === "darwin") {
      this.ensureCommands(["brew"]);
      modifyMongoConf("/usr/local/etc/mongod.conf", auth, bindAll);

      try {
        await _child_process.default.exec("brew services restart mongodb");
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
      string: ["port", "new-name", "output"],
      boolean: ["help", "version", "new-passwords", "auth", "bind-all", "debug"]
    };
    const args = (0, _minimist.default)(argv, options);

    if (args.version) {
      this.log.info(`${_version.fullVersion}`);
      return 0;
    }

    let command = args._[0];
    command = command ? command.toLowerCase() : "help";
    this.debug = !!args.debug;
    await _fsExtra.default.ensureDir(BongoTool.dir);
    this.ensureCommands(["mongo", "mongostat"]);

    switch (command) {
      case "users":
        if (args.help) {
          this.log.info(`Usage: ${this.toolName} users [db]

Description:

Ensures that the users 'admin' & 'user' exist on regular database, and 'root',
or 'backup' & 'restore' users if the 'admin' database is specified.

Options:

  --new-passwords   Generate new passwords for existing users.
`);
          return 0;
        }

        if (args._[1] === "admin") {
          await this.usersAdmin(args["new-passwords"]);
        } else {
          await this.users(args._[1], args["new-passwords"]);
        }

        break;

      case "backup":
        if (args.help) {
          this.log.info(`Usage: ${this.toolName} backup <options> <db>

Description:

Backs up all non-system collections in the given database creating a
timestamped .tar.gz file.

Options:

--port          Host port, for when there are multiple mongod instances
--new-name      Rename the database when backing it up
--output        Output directory or filename for archive file
`);
          return 0;
        }

        const dbName = args._[1];

        if (!dbName) {
          throw new Error(`Database name must be given`);
        }

        await this.backup(dbName, args["port"], args["new-name"], args["output"]);
        break;

      case "restore":
        if (args.help) {
          this.log.info(`Usage: ${this.toolName} restore <options> <archive>

Description:

Restores the database in the given .tar.gz file.  The database will be restored
with the name it had when backed up.

Options:

--port       Host port, for when there are multiple mongod instances
`);
          return 0;
        }

        const archiveFilename = args._[1];

        if (!archiveFilename) {
          throw new Error(`Archive file name must be given`);
        }

        await this.restore(archiveFilename, args["port"]);
        break;

      case "mongo":
        if (args.help) {
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

        await this.mongo(args.auth, args["bind-all"]);
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

_defineProperty(BongoTool, "dir", _path.default.join(_process.default.env.HOME, ".bongo"));

_defineProperty(BongoTool, "credentialsFile", _path.default.join(BongoTool.dir, "credentials.json5"));
//# sourceMappingURL=BongoTool.js.map