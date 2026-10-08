// Cross-layer domain grant channel (ADR-023): Layer 2's persisted "remember"
// reaches Layer 1's live proxy config through pi's event bus. No pi, no fs.
import { DOMAIN_GRANT_CHANNEL, emitDomainGrant, onDomainGrant } from '../../../src/shared/network-grants.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const makeBus = () => {
	const handlers = new Map();
	return {
		emit(channel, data) { for (const h of handlers.get(channel) ?? []) h(data); },
		on(channel, handler) {
			const list = handlers.get(channel) ?? [];
			list.push(handler);
			handlers.set(channel, list);
			return () => handlers.set(channel, list.filter((h) => h !== handler));
		},
	};
};

const bus = makeBus();
const seen = [];
const off = onDomainGrant(bus, (host) => seen.push(host));

emitDomainGrant(bus, 'example.com');
check('grant delivered', JSON.stringify(seen) === '["example.com"]');
emitDomainGrant(bus, 'api.example.com');
check('second grant delivered', JSON.stringify(seen) === '["example.com","api.example.com"]');
check('channel name is the shared constant', DOMAIN_GRANT_CHANNEL === 'auto-permission-system:domain-grant');

bus.emit(DOMAIN_GRANT_CHANNEL, { host: 42 });
bus.emit(DOMAIN_GRANT_CHANNEL, {});
bus.emit(DOMAIN_GRANT_CHANNEL, null);
bus.emit(DOMAIN_GRANT_CHANNEL, 'nope');
check('malformed payloads ignored', seen.length === 2);

const otherSeen = [];
onDomainGrant(makeBus(), (host) => otherSeen.push(host));
emitDomainGrant(bus, 'after-other-bus.example.com');
check('a separate bus receives nothing', otherSeen.length === 0);

off();
emitDomainGrant(bus, 'after-off.example.com');
check('unsubscribe stops delivery', seen.length === 3);

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
