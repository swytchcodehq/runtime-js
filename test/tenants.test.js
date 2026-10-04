const assert = require('node:assert');
const { test, describe, mock, afterEach } = require('node:test');
const cp = require('node:child_process');
const { exec } = require('../dist/exec.js');
const { connect, saveKey, disconnect } = require('../dist/tenants.js');
const { SwytchcodeError } = require('../dist/errors.js');

function fakeSpawn(stdout, status = 0, stderr = '') {
    return mock.method(cp, 'spawnSync', () => ({ status, stdout, stderr, pid: 1, output: [], signal: null }));
}

describe('Tenants (multi-tenant helpers)', () => {
    afterEach(() => mock.restoreAll());

    test('exec() passes --tenant with the trimmed id', async () => {
        const spawn = fakeSpawn('{"ok":true}');
        await exec('gmail.send', { body: {} }, { tenantId: ' alice ' });
        const args = spawn.mock.calls[0].arguments[1];
        assert.deepStrictEqual(args.slice(-2), ['--tenant', 'alice']);
    });

    test('exec() without tenantId passes no --tenant', async () => {
        const spawn = fakeSpawn('{"ok":true}');
        await exec('gmail.send', { body: {} });
        assert.ok(!spawn.mock.calls[0].arguments[1].includes('--tenant'));
    });

    test('exec() passes --tenant-label after the tenant', async () => {
        const spawn = fakeSpawn('{"ok":true}');
        await exec('gmail.send', { body: {} }, { tenantId: 'alice', tenantLabel: ' Alice Smith (alice@acme.com) ' });
        const args = spawn.mock.calls[0].arguments[1];
        assert.deepStrictEqual(args.slice(-4), ['--tenant', 'alice', '--tenant-label', 'Alice Smith (alice@acme.com)']);
    });

    test('exec() refuses tenantLabel without tenantId', async () => {
        const spawn = fakeSpawn('{}');
        await assert.rejects(exec('gmail.send', {}, { tenantLabel: 'Alice' }), /tenantLabel needs tenantId/);
        assert.strictEqual(spawn.mock.callCount(), 0);
    });

    test('exec() rejects an empty tenantId instead of using the developer account', async () => {
        const spawn = fakeSpawn('{}');
        await assert.rejects(exec('gmail.send', {}, { tenantId: '  ' }), SwytchcodeError);
        assert.strictEqual(spawn.mock.callCount(), 0);
    });

    test('exec() surfaces tenant_not_connected as the error category', async () => {
        fakeSpawn('', 3, JSON.stringify({
            error: 'alice has not connected google',
            category: 'tenant_not_connected',
            retryable: false,
            suggested_action: 'show the end user the connect button',
        }));
        await assert.rejects(exec('gmail.send', {}, { tenantId: 'alice' }), (e) => {
            assert.strictEqual(e.details.category, 'tenant_not_connected');
            assert.strictEqual(e.details.retryable, false);
            return true;
        });
    });

    test('connect() runs auth connect --tenant --json and returns the link', () => {
        const spawn = fakeSpawn(JSON.stringify({
            authorization_url: 'https://auth.example/?state=s',
            connected_account_uuid: 'ca-1',
            provider_slug: 'google',
            tenant_id: 'alice',
        }));
        const res = connect({ provider: 'google', tenantId: 'alice' });
        assert.deepStrictEqual(res, { url: 'https://auth.example/?state=s', connectedAccountUuid: 'ca-1' });
        assert.deepStrictEqual(spawn.mock.calls[0].arguments[1], ['auth', 'connect', 'google', '--tenant', 'alice', '--json']);
    });

    test('connect() on an API-key provider points to saveKey()', () => {
        fakeSpawn('');
        assert.throws(() => connect({ provider: 'stripe', tenantId: 'alice' }), /saveKey/);
    });

    test('saveKey() sends the key on stdin, never as an argument', () => {
        const spawn = fakeSpawn(JSON.stringify({ provider_slug: 'stripe', tenant_id: 'alice', auth_type: 'api_key', stored: 'local' }));
        saveKey({ provider: 'stripe', tenantId: 'alice', key: 'sk_test_123' });
        const call = spawn.mock.calls[0].arguments;
        assert.ok(!call[1].includes('sk_test_123'));
        assert.strictEqual(call[2].input, 'sk_test_123\n');
    });

    test('disconnect() runs auth disconnect --tenant without --json', () => {
        const spawn = fakeSpawn('Disconnected google for end user "alice".');
        disconnect({ provider: 'google', tenantId: 'alice' });
        assert.deepStrictEqual(spawn.mock.calls[0].arguments[1], ['auth', 'disconnect', 'google', '--tenant', 'alice']);
    });

    test('helpers refuse an empty tenantId', () => {
        const spawn = fakeSpawn('{}');
        assert.throws(() => connect({ provider: 'google', tenantId: '' }), SwytchcodeError);
        assert.throws(() => disconnect({ provider: 'google', tenantId: ' ' }), SwytchcodeError);
        assert.strictEqual(spawn.mock.callCount(), 0);
    });
});

describe('Swytchcode client bound to an end user', () => {
    afterEach(() => mock.restoreAll());
    const { Swytchcode } = require('../dist/client.js');
    const ok = () => mock.method(cp, 'spawnSync', () => ({ status: 0, stdout: '{"ok":true}', stderr: '', pid: 1, output: [], signal: null }));

    test('tools.execute passes the bound tenant', async () => {
        const spawn = ok();
        await new Swytchcode(undefined, { tenantId: 'alice' }).tools.execute('gmail.send', { to: 'x@y.z' });
        assert.deepStrictEqual(spawn.mock.calls[0].arguments[1].slice(-2), ['--tenant', 'alice']);
    });

    test('tool calls picked by an agent (handleToolCalls) run for the bound tenant', async () => {
        const spawn = ok();
        const client = new Swytchcode(undefined, { tenantId: 'bob' });
        await client.handleToolCalls({ content: [{ type: 'tool_use', id: 't1', name: 'gmail_send', input: {} }] });
        assert.deepStrictEqual(spawn.mock.calls[0].arguments[1].slice(-2), ['--tenant', 'bob']);
    });

    test('an unbound client passes no tenant', async () => {
        const spawn = ok();
        await new Swytchcode().tools.execute('gmail.send', {});
        assert.ok(!spawn.mock.calls[0].arguments[1].includes('--tenant'));
    });

    test('an empty tenantId is refused', () => {
        assert.throws(() => new Swytchcode(undefined, { tenantId: ' ' }), SwytchcodeError);
    });

    test('the bound label goes with the bound tenant only', async () => {
        const spawn = ok();
        const client = new Swytchcode(undefined, { tenantId: 'alice', tenantLabel: 'Alice Smith' });
        await client.tools.execute('gmail.send', {});
        await client.tools.execute('gmail.send', {}, { tenantId: 'bob' });
        assert.deepStrictEqual(spawn.mock.calls[0].arguments[1].slice(-4), ['--tenant', 'alice', '--tenant-label', 'Alice Smith']);
        assert.deepStrictEqual(spawn.mock.calls[1].arguments[1].slice(-2), ['--tenant', 'bob']);
        assert.throws(() => new Swytchcode(undefined, { tenantLabel: 'Alice' }), /tenantLabel needs tenantId/);
    });
});
