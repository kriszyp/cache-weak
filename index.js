const { LRFUExpirer, EXPIRED_ENTRY } = require('./LRFUExpirer')

class WeakLRUCache extends Map  {
	constructor(entries, options) {
		super(entries)
		this.expirer = (options ? options.expirer === false ? new NoLRUExpirer() : options.expirer : null) || defaultExpirer
		this.deferRegister = Boolean(options && options.deferRegister)
		if (options && options.cacheSize) {
			this.expirer.lruSize = options.cacheSize >> 2
			this.expirer.clear()
		}
		let registry = this.registry = new FinalizationRegistry(key => {
			let entry = super.get(key)
			if (entry && entry.deref && entry.deref() === undefined)
				super.delete(key)
		})
	}
	onRemove(entry) {
		let target = entry.deref && entry.deref()
		if (target) {
			// remove strong reference, so only a weak reference, wait until it is finalized to remove
			this.registry.register(target, entry.key)
			entry.value = undefined
		} else if (entry.key) {
			let currentEntry = super.get(entry.key)
			if (currentEntry === entry)
				super.delete(entry.key)
		}
	}
	get(key, mode) {
		let entry = super.get(key)
		let value
		if (entry) {
			value = entry.value
			if (value === EXPIRED_ENTRY) {
				value = entry.deref && entry.deref()
				if (value === undefined)
					super.delete(key)
				else {
					entry.value = value
					if (mode !== 1)
						this.expirer.used(entry)
					return mode === 2 ? value : entry
				}
			}
			else {
				if (mode !== 1)
					this.expirer.used(entry)
				return mode === 2 ? value : entry
			}
		}
	}
	getValue(key) {
		return this.get(key, 2)
	}

	setValue(key, value, expirationPriority) {
		let entry
		if (value && typeof value == 'object') {
			entry = new WeakRef(value)
			entry.value = value
			if (this.deferRegister) {
				entry.key = key
				entry.cache = this
			} else
				this.registry.register(value, key)
		} else if (value !== undefined)
			entry = { value, key, cache: this }
		// else entry is undefined
		this.set(key, entry, expirationPriority)
		return entry
	}
	set(key, entry, expirationPriority) {
		let oldEntry = super.get(key)
		if (oldEntry)
			this.expirer.delete(oldEntry)
		return this.insert(key, entry, expirationPriority)
	}
	insert(key, entry, expirationPriority) {
		if (entry) {
			this.expirer.used(entry, expirationPriority)
		}
		return super.set(key, entry)
	}
	delete(key) {
		let oldEntry = this.get(key)
		if (oldEntry) {
			this.expirer.delete(oldEntry)
		}
		return super.delete(key)
	}
	used(entry, expirationPriority) {
		this.expirer.used(entry, expirationPriority)
	}
	clear() {
		this.expirer.clear()
		super.clear()
	}
}

class NoLRUExpirer {
	used(entry) {
		if (entry.cache)
			entry.cache.onRemove(entry)
		else if (entry.deref) // if we have already registered the entry in the finalization registry, just clear it
			entry.value = undefined
	}
	delete(entry) {
		// nothing to do here, we don't have a separate cache here
	}
}

const defaultExpirer = new LRFUExpirer()
exports.WeakLRUCache = WeakLRUCache
exports.LRFUExpirer = LRFUExpirer