#! /usr/bin/env node

const Chalk = require('chalk');
const Chokidar = require('chokidar');
const ChildProcess = require('child_process');
const Fs = require('fs');
const Penseur = require('penseur');
const Tmp = require('tmp');
const Rimraf = require('rimraf');
const Path = require('path');

Tmp.setGracefulCleanup();

const [dbName, tbl, id] = process.argv.slice(2);

let db;
let proc;
let openAt;

const spawn = (bin, args) => {

    return new Promise((resolve) => {

        proc = ChildProcess.spawn(bin, args, { stdio: 'inherit' });

        proc.on('exit', (code) => resolve(code));
        proc.on('error', (err) => reject(err));
    });
};

const cleanup = () => Rimraf.sync(openAt);

const start = async () => {

    if (!dbName || !tbl) {
        throw new Error('Usage: redit [db] [tbl] ([id])');
    }

    const EDITOR = process.env.EDITOR;

    if (!EDITOR) {
        throw new Error('Looks like $EDITOR is missing. Try \'export EDITOR=vim\'');
    }

    db = new Penseur.Db(dbName, { host: 'localhost', port: 28015 });
    db.table(tbl);
    await db.connect();

    let files = [];

    if (id) {
        const obj = await db[tbl].get(id);

        if (!obj) {
            throw new Error(`Record ${tbl}:${id} not found in database ${dbName}`);
        }
        else {
            const tmp = Tmp.fileSync({ postfix: '.json' });
            files.push(tmp.name);
            openAt = tmp.name;
            Fs.writeFileSync(tmp.name, JSON.stringify(obj, null, 2));
        }
    } else {
        const all = await db[tbl].all();
        const tmp = Tmp.dirSync();
        openAt = tmp.name;

        for (const record of all) {
            const fn = `${tmp.name}/${record.id}.json`;
            files.push(fn);
            Fs.writeFileSync(fn, JSON.stringify(record, null, 2));
        }
    }

    const watcher = Chokidar.watch(files, { persistent: false, usePolling: true });

    watcher.on('change', async (file) => {

        try {
            const contents = Fs.readFileSync(file);
            const parsed = JSON.parse(contents.toString());
            await db[tbl].insert(parsed, { merge: 'replace' });
            console.info(Chalk.yellow(`Updated record with id "${id || Path.parse(file).name}" in table "${tbl}", database "${dbName}".`));
        } catch (err) {
            exit(1, err);
        }
    });

    const args = process.env.EDITOR.split(' ');
    await spawn(args[0], [...args.slice(1), openAt]);

    cleanup();
    await db.close();
};

const exit = async (code, err) => {

    try {
        cleanup();
        db && await db.close();
        proc && proc.kill('SIGKILL');
    } catch (err) {
        // ignore errors in cleanup
    }

    if (err) {
        console.error(Chalk.red(err));
    }

    process.exit(code);
};

start()
    .catch(err => exit(1, err))
    .then(() => console.log(Chalk.green('Success!')));
