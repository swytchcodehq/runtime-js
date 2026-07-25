const assert = require('node:assert');
const { test, describe, mock, afterEach } = require('node:test');
const discover = require('../dist/discover.js');
const cli = require('../dist/cli.js');
const { Swytchcode } = require('../dist/client.js');
const { SwytchcodeError } = require('../dist/errors.js');

describe('Tools & Discovery (discover.js & manage.js)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    describe('discover.info() and discover.search() Failure Paths', () => {
        test('discover.info() handles CLI failure gracefully', () => {
            // Mock the underlying CLI execution to simulate a failure
            mock.method(cli, 'runCli', () => { 
                throw new SwytchcodeError('CLI failed to fetch tool info', 1); 
            });

            // Mock console.warn to verify it logs the warning and to keep test output clean
            const warned = mock.fn();
            mock.method(console, 'warn', warned);

            // Execute the actual function
            const res = discover.info('invalid.tool.id');

            // Assert it catches the error and returns the fallback object
            assert.deepStrictEqual(res, { canonical_id: 'invalid.tool.id', inputs: {} });
            assert.strictEqual(warned.mock.calls.length, 1);
        });

        test('discover.search() handles malformed CLI responses gracefully', () => {
            // Mock the underlying CLI execution to simulate a failure
            mock.method(cli, 'runCli', () => { 
                throw new SwytchcodeError('Invalid JSON from swytchcode', 'Malformed data'); 
            });

            // Mock console.warn
            const warned = mock.fn();
            mock.method(console, 'warn', warned);

            // Execute the actual function
            const res = discover.search('refund');

            // Assert it catches the error and returns the fallback empty array
            assert.deepStrictEqual(res, []);
            assert.strictEqual(warned.mock.calls.length, 1);
        });
    });

    describe('Tools.get() Selector Validation', () => {
        test('Tools.get() tolerates combined selectors (tools takes precedence) without invoking the CLI', async () => {
            // Stub discover.info so it never touches the external binary
            mock.method(discover, 'info', () => ({ canonical_id: 'x.y', inputs: {}, summary: 'Test tool' }));
            
            const client = new Swytchcode();
            const tools = await client.tools.get({ search: 'test', tools: ['x.y'] });
            
            assert.strictEqual(tools.length, 1);
            assert.strictEqual(tools[0].canonicalId, 'x.y');
        });

        test('gracefully handles selector arguments of the wrong type', async () => {
            // Mock the underlying CLI execution to simulate a failure, as requested
            mock.method(cli, 'runCli', () => { 
                throw new SwytchcodeError('command failed', 1); 
            });
            
            const client = new Swytchcode();
           
            const tools = await client.tools.get({ search: 123 }); 
            
            // Strictly assert that it returns an empty array rather than just checking if it is an array
            assert.deepStrictEqual(tools, []);
        });
    });
});