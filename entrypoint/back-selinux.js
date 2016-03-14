#!/usr/bin/env node
"use strict";

// This file is the entrypoint for back-master, intended for use with the "SELinux" backend.  The "Docker" backend has its own initialization built in to the Dockerfiles.
// This file intentionally has no dependencies on npm modules to make it more portable.

const child_process = require("child_process");
const fs = require("fs");
const path = require("path");

// Print basic information about the process
console.log("Daemon PID:", process.pid);
console.log("Date:", new Date().toISOString());

// What files will we be loading?
const prefix = (__dirname === "/usr/local/bin") ? "/usr/local/share/oo" : path.join(__dirname, "..");
const configFile = path.join(prefix, "shared/config.json");
const gitSshFile = path.join(prefix, "back-filesystem/git/git_ssh.sh");
const spawnDirectory = path.join(prefix, "back-master");
const spawnFile = path.join(prefix, "back-master/app.js");

// Wait until the application code is ready before continuing.  Example: network drives being mounted at startup.
while (true) {
	try {
		fs.statSync(configFile);
		fs.statSync(gitSshFile);
		fs.statSync(spawnDirectory);
		fs.statSync(spawnFile);
		break;
	} catch(err) {
		console.log("One or more dependencies not available!  Trying again in 5 seconds...");
		child_process.execSync("sleep 5");  // blocking sleep
	}
}

// Load config file dependency
const config = require(configFile);

// Make log directories
try {
	fs.mkdirSync(path.join(config.worker.logDir, "monitor"), "0740");
	fs.mkdirSync(path.join(config.worker.logDir, "sessions"), "0740");
} catch(err) {
	if (/EEXIST/.test(err.message)) {
		console.log("Using pre-existing log directories.");
	} else throw err;
}

// Create log stream
let dateStr = new Date().toISOString().replace(/:/g,"-").replace(".","-").replace("T","_").replace("Z","");
let logPath = path.join(config.worker.logDir, "monitor", config.worker.token+"_"+dateStr+".log");
let logFd = fs.openSync(logPath, "a", "0640");
let logStream = fs.createWriteStream(null, { fd: logFd });
console.log("Logging to:", logPath);

// Prepare child process environment and copy all environment variables
const spawnOptions = {
	cwd: spawnDirectory,
	env: {
		"GIT_SSH": gitSshFile,
		"GNUTERM": "svg",
		"DEBUG": "*"
	},
	uid: config.worker.uid,
	gid: config.worker.uid,
	stdio: ["inherit", "inherit", logStream]
};
for (var name in process.env) {
	if (!(name in spawnOptions.env)) {
		spawnOptions.env[name] = process.env[name];
	}
}

// Signal Handling
var sigCount = 0;
var spwn;
function doExit() {
	if (sigCount === 0) {
		console.log("RECEIVED FIRST SIGNAL.  Terminating gracefully.");
		if (spwn) spwn.kill("SIGTERM");
	} else if (sigCount < 5) {
		console.log("RECEIVED SIGNAL 2-5.  Ignoring.");
	} else {
		console.log("RECEIVED FINAL SIGNAL.  Killing child process now.");
		if (spwn) spwn.kill("SIGKILL");
		process.exit(1);
	}
	sigCount++;
}
process.on("SIGINT", doExit);
process.on("SIGHUP", doExit);
process.on("SIGTERM", doExit);

// Spawn loop
function runOnce() {
	console.log(spawnOptions);
	spwn = child_process.spawn("/usr/bin/env", ["node", spawnFile], spawnOptions);
	console.log(`Starting child (${spawnFile}) with PID ${spwn.pid}`);
	spwn.once("exit", (code, signal) => {
		console.log(`Process exited with code ${code}, signal ${signal}`);
		if (code !== 0) {
			setTimeout(runOnce, 500);
		} else {
			child_process.execSync("sudo reboot");
		}
	});
}

// Run it!
runOnce(logStream);
