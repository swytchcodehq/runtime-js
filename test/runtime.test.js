const assert = require('node:assert');
const { test } = require('node:test');
const { simplify } = require('../dist/schema.js');

test('Schema correctly marks path parameters as required', () => {
    const rawSchema = [
        {
            "userId": {
                "TYPE": "STRING",
                "LOCATION": "path",
                "DESC": "The user ID"
            }
        },
        {
            "amount": {
                "TYPE": "INT",
                "LOCATION": "query"
            }
        }
    ];

    const simplified = simplify(rawSchema);

    // Path parameters should be forced to be required
    assert.deepStrictEqual(simplified.required, ["userId"]);
    assert.strictEqual(simplified.properties.userId.type, "string");
    assert.strictEqual(simplified.properties.amount.type, "integer");
});

test('Schema correctly marks JSON-Schema path parameters as required', () => {
    const rawSchema = {
        type: "object",
        properties: {
            "owner": { "type": "string", "location": "path" },
            "repo": { "type": "string", "location": "path" },
            "title": { "type": "string", "location": "body" }
        }
    };
    const simplified = simplify(rawSchema);
    assert.ok(simplified.required.includes("owner"));
    assert.ok(simplified.required.includes("repo"));
    assert.ok(!simplified.required.includes("title"));
});

test('VercelProvider uses inputSchema instead of parameters', async () => {
    const { VercelProvider } = require('../dist/providers/vercel.js');
    const provider = new VercelProvider();
    const toolDef = {
        canonicalId: "x.y",
        name: "x_y",
        description: "A test tool",
        inputSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        execute: async () => {}
    };
    const formatted = await provider.formatTool(toolDef);
    assert.ok(formatted.inputSchema !== undefined, 'Vercel tool must have inputSchema - model sees zero inputs');
});

test('Schema correctly marks array Wreken path parameters as required', () => {
    const rawSchema = [
        { "owner": { "TYPE": "STRING", "LOCATION": "path" } },
        { "title": { "TYPE": "STRING", "LOCATION": "body" } }
    ];
    const simplified = simplify(rawSchema);
    assert.ok(simplified.required.includes("owner"));
    assert.ok(!simplified.required.includes("title"));
});

test('CrewAIProvider produces correct duck-typed shape', async () => {
    const { CrewAIProvider } = require('../dist/providers/crewai.js');
    const provider = new CrewAIProvider();
    const toolDef = {
        canonicalId: "test.tool",
        name: "test_tool",
        description: "A crewai test tool",
        inputSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        execute: async (args) => { return args; }
    };
    const formatted = provider.formatTool(toolDef);
    assert.strictEqual(formatted.name, "test_tool");
    assert.strictEqual(formatted.description, "A crewai test tool");
    assert.deepStrictEqual(formatted.schema, toolDef.inputSchema);
    assert.strictEqual(typeof formatted.func, "function");
    
    // Ensure func returns stringified JSON as expected
    const res = await formatted.func({ a: "test" });
    assert.strictEqual(res, '{"a":"test"}');
});

test('TOOL_USE_INSTRUCTIONS is exported, instructs the model to call tools, and scopes itself to Swytchcode tools only', () => {
    const { TOOL_USE_INSTRUCTIONS } = require('../dist/index.js');
    assert.strictEqual(typeof TOOL_USE_INSTRUCTIONS, 'string');
    assert.ok(TOOL_USE_INSTRUCTIONS.length > 0);
    assert.match(TOOL_USE_INSTRUCTIONS, /call the matching tool/i);
    assert.match(TOOL_USE_INSTRUCTIONS, /does not affect how you use any\s+other tools/i);
});

test('parseClassifiedError extracts the CLI\'s classified JSON error from stderr', () => {
    const { parseClassifiedError } = require('../dist/exec.js');
    const stderr = JSON.stringify({
        error: 'missing credentials for github - run `swytchcode auth connect github`',
        category: 'auth',
        retryable: false,
        suggested_action: 'to access registry features, run: swytchcode login',
        docs_url: 'https://docs.swytchcode.com/auth',
    });
    const parsed = parseClassifiedError(stderr);
    assert.strictEqual(parsed.error, 'missing credentials for github - run `swytchcode auth connect github`');
    assert.strictEqual(parsed.category, 'auth');
    assert.strictEqual(parsed.suggested_action, 'to access registry features, run: swytchcode login');
});

test('parseClassifiedError returns null for non-JSON or shapeless stderr', () => {
    const { parseClassifiedError } = require('../dist/exec.js');
    assert.strictEqual(parseClassifiedError(''), null);
    assert.strictEqual(parseClassifiedError('a plain-text panic, not JSON'), null);
    assert.strictEqual(parseClassifiedError('{"not_error_field": true}'), null);
});

test('Deterministic alias generation and round-tripping for >64 char IDs', async () => {
    const { Swytchcode } = require('../dist/client.js');
    const discover = require('../dist/discover.js');
    
    // Mock discover to return a huge canonical ID
    const origInfo = discover.info;
    const origSearch = discover.search;
    
    const longId = "google_workspace_admin_directory_users_aliases_insert_extra_padding_to_exceed_limit";
    discover.info = (cid) => {
        if (cid === longId) {
            return { inputs: { "email": { "TYPE": "STRING" } }, summary: "Test tool" };
        }
        return origInfo(cid);
    };
    discover.search = () => [{ canonical_id: longId }];
    
    try {
        const client = new Swytchcode();
        
        // 1. Fetch tools
        const tools = await client.tools.get({ search: "test" });
        assert.strictEqual(tools.length, 1);
        
        const alias = tools[0].name;
        
        // 2. Assert length is <= 64 and matches regex
        assert.ok(alias.length <= 64, `Alias length ${alias.length} should be <= 64`);
        assert.match(alias, /^[a-zA-Z0-9_-]{1,64}$/);
        
        // 3. Assert determinism (calling it again yields exact same alias)
        const client2 = new Swytchcode();
        const tools2 = await client2.tools.get({ search: "test" });
        assert.strictEqual(tools2[0].name, alias);
        
        // 4. Assert round-tripping
        const cidResolved = client.tools.nameToId(alias);
        assert.strictEqual(cidResolved, longId);
        
        // 5. Test collision natively via discover mock
        const origInfo2 = discover.info;
        const origSearch2 = discover.search;
        try {
            discover.info = (cid) => ({ inputs: { "a": { "TYPE": "STRING" } }, summary: "Test tool" });
            discover.search = () => [{ canonical_id: "a.b" }, { canonical_id: "a_b" }];
            const client3 = new Swytchcode();
            const tools3 = await client3.tools.get({ search: "test" });
            const alias1 = tools3.find(t => t.canonicalId === "a.b").name;
            const alias2 = tools3.find(t => t.canonicalId === "a_b").name;
            
            assert.notStrictEqual(alias1, alias2);
            // One of them must have received the hash (length 10: a_b_xxxxxx)
            const hashedAlias = alias1.length > 3 ? alias1 : alias2;
            assert.match(hashedAlias, /_[0-9a-f]{6}$/);
        } finally {
            discover.info = origInfo2;
            discover.search = origSearch2;
        }
    } finally {
        discover.info = origInfo;
        discover.search = origSearch;
    }
});
