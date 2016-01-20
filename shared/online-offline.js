"use strict";

const EventEmitter = require("events");
const log = require("./logger")("online-offline");
const Queue = require("./queue");

/**
 * This is a class that handles safely creating and destroying something asynchronously.
 * Possible states: INIT, CREATING, ONLINE, PENDING-DESTROY, DESTROYED, and PENDING-DESTROYED.
 * Required methods to implement in derived classes: _doCreate, _doDestroy.
 * Derived classes may read the state but should never change it.
 */

class OnlineOffline extends EventEmitter {
	constructor() {
		super();

		this._state = "INIT";
		this._createCBs = new Queue();
		this._destroyCBs = new Queue();
	}

	create(next) {
		next = next || function(){};
		switch (this._state) {
			case "INIT":
				this._state = "CREATING";
				this._createCBs.enqueue(next);
				let args = Array.prototype.slice.call(arguments, 1);
				args.unshift(this._afterCreate.bind(this));
				this._doCreate.apply(this, args);
				break;

			case "CREATING":
			case "PENDING-DESTROY":
				this._createCBs.enqueue(next);
				break;

			case "ONLINE":
				return next(new Error("Already created"));

			case "DESTROYED":
				return next(new Error("Already destroyed"));

			default:
				this._log.error("Unknown state:", this._state);
				return next(new Error("Internal online-offline error"));
		}
	}

	_afterCreate(err) {
		switch (this._state) {
			case "CREATING":
				this._state = "ONLINE";
				if (err) {
					this.destroy();
				}
				break;

			case "PENDING-DESTROY":
				this._state = "ONLINE";
				this.destroy();
				if (!err) {
					err = new Error("Pending destroy");
				}
				break;

			case "CREATING":
			case "ONLINE":
			case "DESTROYED":
				this._log.error("Unexpected state:", this._state);
				break;

			default:
				this._log.error("Unknown state:", this._state);
				break;
		}

		let args = Array.prototype.slice.call(arguments, 1);
		args.unshift(err);

		while (!this._createCBs.isEmpty()) {
			let cb = this._createCBs.dequeue();
			cb.apply(this, args);
		}
	}

	destroy(next) {
		next = next || function(){};
		switch (this._state) {
			case "ONLINE":
				this._state = "DESTROYED";
				this._destroyCBs.enqueue(next);
				let args = Array.prototype.slice.call(arguments, 1);
				args.unshift(this._afterDestroy.bind(this));
				this._doDestroy.apply(this, args);
				break;

			case "CREATING":
			case "PENDING-DESTROY":
				this._state = "PENDING-DESTROY";
				this._destroyCBs.enqueue(next);
				break;

			case "INIT":
				this._state = "DESTROYED";
				return next(null);

			case "DESTROYED":
				return next(null);

			default:
				this._log.error("Unknown state:", this._state);
				return next(new Error("Internal online-offline error"));
		}
	}

	_afterDestroy(err) {
		switch (this._state) {
			case "DESTROYED":
				break;

			case "INIT":
			case "CREATING":
			case "ONLINE":
			case "PENDING-DESTROY":
				this._log.error("Unexpected state:", this._state);
				break;

			default:
				this._log.error("Unknown state:", this._state);
				break;
		}

		while (!this._destroyCBs.isEmpty()) {
			let cb = this._destroyCBs.dequeue();
			cb(err);
		}
	}
}

module.exports = OnlineOffline;
