const assert = require('node:assert');
const { test, describe, mock, afterEach } = require('node:test');
const { Swytchcode } = require('../dist/client.js');
const { SwytchcodeError } = require('../dist/errors.js');

describe('Execution & Routing Isolation', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    describe('handleToolCalls() Error Isolation', () => {
        test('prevents a single tool failure from crashing a batch execution', async () => {
            const client = new Swytchcode();
            
            // 1. Mock the internal execute method to simulate success and failure
            mock.method(client.tools, 'execute', async (cid) => {
                if (cid === 'api.fail') {
                    throw new SwytchcodeError('Tool crashed', 500);
                }
                return { success: true };
            });

            // 2. Mock internal helpers to pass through cleanly
            mock.method(client.tools, 'nameToId', (name) => name.replace('_', '.'));
            mock.method(client.tools, 'getInputs', () => ({}));

            // 3. Create a mock Anthropic-style response with two tool calls
            const mockResponse = {
                content: [
                    { type: 'tool_use', id: 'call_1', name: 'api_success', input: {} },
                    { type: 'tool_use', id: 'call_2', name: 'api_fail', input: {} }
                ]
            };

            const results = await client.handleToolCalls(mockResponse);

            // Both tools should have a result entry, and the whole function shouldn't throw
            assert.strictEqual(results.length, 2);
            
            // Verify the successful execution
            const successResult = results.find(r => r.tool_use_id === 'call_1');
            assert.ok(successResult, 'Expected a tool_result for call_1');
            assert.strictEqual(successResult.type, 'tool_result');
            assert.deepStrictEqual(JSON.parse(successResult.content), { success: true });

            // Verify the failed execution degraded gracefully
            const failResult = results.find(r => r.tool_use_id === 'call_2');
            assert.ok(failResult, 'Expected a tool_result for call_2');
            assert.strictEqual(failResult.type, 'tool_result');
            assert.strictEqual(failResult.is_error, true);
            assert.ok(failResult.content.includes('Tool crashed'));
        });
    });
});