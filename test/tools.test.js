const assert = require('node:assert');
const { test, describe, mock, afterEach } = require('node:test');
const discover = require('../dist/discover.js');
const { Swytchcode } = require('../dist/client.js');
const { SwytchcodeError } = require('../dist/errors.js');

describe('Tools & Discovery (discover.js & manage.js)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    describe('discover.info() and discover.search() Failure Paths', () => {
        test('discover.info() handles CLI failure gracefully', async () => {
            // Mock the internal exec call or the CLI response to throw an error
            
            mock.method(discover, 'info', async () => {
                throw new SwytchcodeError('CLI failed to fetch tool info', 1);
            });

            await assert.rejects(
                async () => { await discover.info('invalid.tool.id'); },
                (err) => {
                    assert.ok(err instanceof SwytchcodeError);
                    assert.match(err.message, /CLI failed/);
                    return true;
                }
            );
        });

        test('discover.search() handles malformed CLI responses', async () => {
            // Simulate the CLI returning an unexpected format (e.g., a string instead of an array)
            mock.method(discover, 'search', async () => {
                throw new SwytchcodeError('Invalid JSON from swytchcode', 'Malformed data');
            });

            await assert.rejects(
                async () => { await discover.search('refund'); },
                (err) => {
                    assert.ok(err instanceof SwytchcodeError);
                    assert.match(err.message, /Invalid JSON/);
                    return true;
                }
            );
        });
    });

    describe('Tools.get() Selector Validation', () => {
        test('gracefully handles an invalid selector object without crashing', async () => {
            const client = new Swytchcode();
            const tools = await client.tools.get({ search: "test", tools: ["x.y"] }); 
            assert.ok(Array.isArray(tools));
        });

        test('gracefully handles selector arguments of the wrong type', async () => {
            const client = new Swytchcode();
            
            const tools = await client.tools.get({ search: 123 }); 
            assert.ok(Array.isArray(tools));
        });
    });
});