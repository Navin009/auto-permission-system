// YOLO (ADR-020): per-extension flag registration and the shared runtime
// event channel that lets `/permission-mode` toggle the layers mid-session.
import { registerYoloFlags, yoloFromFlags, emitYolo, onYolo, YOLO_CHANNEL, YOLO_STATUS } from '../../../src/shared/yolo.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

// --- Flags are extension-scoped, exactly like pi's loader -------------------
// pi's getFlag returns undefined unless THIS extension registered the name.
const makePi = (initial = {}) => {
	const flags = new Set();
	const values = new Map(Object.entries(initial));
	return {
		flags,
		values,
		registerFlag: (name, options) => {
			flags.add(name);
			if (!values.has(name)) values.set(name, options.default);
		},
		getFlag: (name) => (flags.has(name) ? values.get(name) : undefined),
	};
};

const unregistered = makePi({ yolo: true });
check('an unregistered flag reads as undefined (the yolo bug)', unregistered.getFlag('yolo') === undefined);
check('yoloFromFlags is false before registration', yoloFromFlags(unregistered) === false);

const pi = makePi({ yolo: true });
registerYoloFlags(pi);
check('registerYoloFlags registers yolo', pi.flags.has('yolo'));
check('registerYoloFlags registers the alias', pi.flags.has('no-sandbox'));
check('a registered flag reads the CLI value', yoloFromFlags(pi) === true);

const alias = makePi({ 'no-sandbox': true });
registerYoloFlags(alias);
check('the no-sandbox alias alone enables yolo', yoloFromFlags(alias) === true);

const off = makePi();
registerYoloFlags(off);
check('no flag means off', yoloFromFlags(off) === false);

const stringy = makePi({ yolo: 'true' });
registerYoloFlags(stringy);
check('only boolean true enables yolo', yoloFromFlags(stringy) === false);

const empty = { registerFlag: () => {}, getFlag: () => undefined };
registerYoloFlags(empty);
check('registerYoloFlags works through a minimal pi shim', true);

// --- Runtime channel --------------------------------------------------------
const makeBus = () => {
	const handlers = new Map();
	return {
		handlers,
		emit(channel, data) { for (const h of handlers.get(channel) ?? []) h(data); },
		on(channel, handler) {
			const list = handlers.get(channel) ?? [];
			list.push(handler);
			handlers.set(channel, list);
			return () => handlers.set(channel, list.filter((h) => h !== handler));
		},
	};
};

check('the channel is namespaced', YOLO_CHANNEL.startsWith('auto-permission-system:'));
check('the chip text names YOLO', /YOLO/.test(YOLO_STATUS));

const bus = makeBus();
const seen = [];
const offYolo = onYolo(bus, (enabled) => seen.push(enabled));
emitYolo(bus, true);
emitYolo(bus, false);
check('emit/on round-trips both directions', seen.join(',') === 'true,false');
check('the payload carries a boolean', typeof seen[0] === 'boolean');

bus.emit(YOLO_CHANNEL, 'garbage');
bus.emit(YOLO_CHANNEL, undefined);
bus.emit(YOLO_CHANNEL, { enabled: 'yes' });
check('malformed payloads are ignored', seen.length === 2);
bus.emit(YOLO_CHANNEL, { enabled: true });
check('boolean payloads still flow', seen.length === 3 && seen[2] === true);

offYolo();
emitYolo(bus, true);
check('unsubscribe stops delivery', seen.length === 3);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
