# Mongo Bongo

An _opinionated_ tool for managing MongoDB databases. It allows you to easily:

- Configure authenticated databases users
- Manage user passwords
- Perform backups and restores
- Rename databases
- Work with replica sets

Note, this tool has been tested to work with [MongoDB 4.x(https://docs.mongodb.com/manual/), macOS with [Homebrew](https://brew.sh/), and Ubuntu 18.04.

## Users

In an authenticated database, users are stored in the `admin` database. As far as this tool is concerned, there are two categories of users:

- **Administrative Users:** `root`, `backup` and `restore`.
- **Database Users:** `admin` and `user`.

`root` user is only used to manage users across databases. `backup` and `restore` are used for backing up and restoring databases respectively.

Within a database `admin` users are used for things like re-indexing. The `user` is for everything else, and is the user that the an API process will connect as.

### `admin` Database

To create an admin database and add the `root`, etc.. users you must first bind Mongo to `localhost` only and then disable security:

```
bongo mongo --no-auth --no-bind-all
```

Now add the `admin` database users:

```
bongo users admin
```

Running the command when the users already exists just confirms their existence. You can change passwords in future by running:

```
bongo users admin --new-passwords
```

Now re-enable security (and optionally bind to all IP addresses):

```
bongo mongo --auth --bind-all
```

## Credentials File

After running `bongo users admin` you will have a `~/.bongo/credentials.json5` file that contains the users passwords. Having this file makes it easy to find the appropriate passwords to add to your MongoDB URI's when configuring your API services.

_NOTE: If this is alarming to you, realize that it is no different from that way the systems like AWS work when they store login credentials in `~/.aws/credentials` files. The file has the mode set to allow only the user that creates it to read and modify it. Just make sure that the security for account is good, by using only SSH authentication for example._

## Other Databases

To create the approriate users for other databases, with security enabled:

```
bongo users <db>
```

And to regenerate passwords run:

```
bongo users <db> --new-passwords
```

## Backups

To backup a database run:

```
bongo backup <db>
```

You'll get a timestamped `.tar.gz` file in the current directory. Specify `--output <dir>` to change the output directory. This file only contains non-system collections and is moded to only be accessible to the current user. It's a standard, compressed `tar` file. You can specify `--output` to give a different directory for where the file will be placed, but the name will always include the database name and the date/time.

Specify `--port` to use a non-default `mongod` instance. Specify `--new-name` to rename the database when backing it up. This is about as easy and fast as a database rename operation gets in MongoDB.

## Restorations

To restore a backup:

```
bongo restore <archive>
```

Restores the database, _dropping any existing collections with the same_. You can set the `admin` and `user` users with `bongo` as above if needed, or just copy over the `credentials.json` file manually.

You can specify `--port` for non-default `mongod` instances, e.g. replica sets.

## Other

The tool generates cryptographically strong 16 character alphanumeric passwords that should not give any problems when used on the command line or in MongoDB URI's with passwords, e.g. `mongodb://user:zY99Ab8cddf8e01x@localhost:27107/db-name`.

The `bongo mongo` command reads the `mongod.conf` file as YAML and rewrites it _stripping any comments_ If comments in the `.conf` file are important to you then please submit a pull request to add that functionality.
