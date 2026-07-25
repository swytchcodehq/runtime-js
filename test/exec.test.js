const assert = require('node:assert');
const { test, describe, mock, afterEach } = require('node:test');
const cp = require('node:child_process');
const fs = require('node:fs');
const { resolveSwytchcodeBin, buildInvocation, exec } = require('../dist/exec.js');
const { SwytchcodeError } = require('../dist/errors.js');

describe('Core Execution Engine (exec.js)', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        mock.restoreAll();
        process.env = { ...originalEnv };
    });

    test('resolveSwytchcodeBin() prioritizes SWYTCHCODE_BIN env var if set', () => {
        process.env.SWYTCHCODE_BIN = '/custom/path/to/swytchcode';
        const result = resolveSwytchcodeBin('/start/dir');
        assert.strictEqual(result, '/custom/path/to/swytchcode');
    });

    test('resolveSwytchcodeBin() fallbacks to PATH (return "swytchcode") if local missing', () => {
        // Mock fs.existsSync to simulate binary not found anywhere
        mock.method(fs, 'existsSync', () => false);
        const result = resolveSwytchcodeBin('/start/dir');
        assert.strictEqual(result, 'swytchcode');
    });

    test('buildInvocation() invokes binary directly on Unix environments', () => {
        const inv = buildInvocation('/usr/local/bin/swytchcode', ['exec', 'test.id']);
        assert.strictEqual(inv.command, '/usr/local/bin/swytchcode');
        assert.deepStrictEqual(inv.args, ['exec', 'test.id']);
        assert.strictEqual(inv.windowsVerbatimArguments, false);
    });

    test('buildInvocation() wraps in cmd.exe and escapes for Windows .cmd shims', { skip: process.platform !== 'win32' }, () => {
        const inv = buildInvocation('swytchcode.cmd', ['exec', 'my&tool|id']);

        assert.match(inv.command, /cmd\.exe/i);
        assert.strictEqual(inv.windowsVerbatimArguments, true);

        // Assert that the string contains the caret-escaped ampersand
        const fullCommand = inv.args.join(' ');
        assert.ok(fullCommand.includes('^&'), 'Windows metacharacters should be caret-escaped');
    });
    
    describe('exec() Edge Cases', () => {
        test('returns null when JSON mode receives empty stdout', async () => {
            mock.method(cp, 'spawnSync', () => ({
                status: 0,
                stdout: '   \n ', 
                stderr: '',
                pid: 123,
                output: [],
                signal: null,
            }));

            const result = await exec('api.test', { param: 1 });
            assert.strictEqual(result, null);
        });

        test('returns raw string when raw: true is passed', async () => {
            mock.method(cp, 'spawnSync', () => ({
                status: 0,
                stdout: 'raw string output',
                stderr: '',
                pid: 123,
                output: [],
                signal: null,
            }));

            const result = await exec('api.test', {}, { raw: true });
            assert.strictEqual(result, 'raw string output');
        });

        test('throws SwytchcodeError on ETIMEDOUT', async () => {
            mock.method(cp, 'spawnSync', () => ({
                error: { name: 'Error', message: 'timeout', code: 'ETIMEDOUT' },
                status: null,
                pid: 123,
                output: [],
                stdout: '',
                stderr: '',
                signal: null,
            }));

            await assert.rejects(
                async () => { await exec('api.test'); },
                (err) => {
                    assert.ok(err instanceof SwytchcodeError);
                    assert.match(err.message, /timed out/);
                    return true;
                }
            );
        });

        test('throws SwytchcodeError on invalid JSON parsing', async () => {
            mock.method(cp, 'spawnSync', () => ({
                status: 0,
                stdout: '{"bad json": ',
                stderr: '',
                pid: 123,
                output: [],
                signal: null,
            }));

            await assert.rejects(
                async () => { await exec('api.test'); },
                (err) => {
                    assert.ok(err instanceof SwytchcodeError);
                    assert.match(err.message, /Invalid JSON output/);
                    return true;
                }
            );
        });
    });
});