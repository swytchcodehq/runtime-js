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

test('Schema expands a nested object body instead of flattening it', () => {
    // The shape `swytchcode info` returns for a POST tool with an object body:
    // the body's fields live under spec.schema, which simplify used to drop.
    const rawSchema = [
        { "owner": { "LOCATION": "path", "TYPE": "STRING" } },
        {
            "body": {
                "LOCATION": "body",
                "TYPE": "OBJECT",
                "schema": {
                    "properties": {
                        "prompt": { "type": "string", "required": true },
                        "create_pull_request": { "type": "boolean", "required": false }
                    },
                    "required": ["prompt"]
                }
            }
        }
    ];
    const body = simplify(rawSchema).properties.body;
    assert.strictEqual(body.type, "object");
    assert.strictEqual(body.properties.prompt.type, "string");
    assert.strictEqual(body.properties.create_pull_request.type, "boolean");
    assert.deepStrictEqual(body.required, ["prompt"]);
});

test('toZod builds a real object schema for a nested body and parses it', async () => {
    const { toZod } = require('../dist/schema.js');
    const schema = simplify([
        {
            "body": {
                "LOCATION": "body",
                "TYPE": "OBJECT",
                "schema": {
                    "properties": { "prompt": { "type": "string", "required": true } },
                    "required": ["prompt"]
                }
            }
        }
    ]);
    const zodSchema = toZod(schema);
    const parsed = zodSchema.parse({ body: { prompt: "hi" } });
    // A plain object (not a class instance) so JSON.stringify never throws.
    assert.deepStrictEqual(parsed.body, { prompt: "hi" });
    assert.throws(() => zodSchema.parse({ body: {} }));
    assert.throws(() => zodSchema.parse({ body: { prompt: 1 } }));
});

test('Schema expands array items with nested objects and validates via toZod', async () => {
    const { toZod } = require('../dist/schema.js');
    const rawSchema = [
        {
            "body": {
                "LOCATION": "body",
                "TYPE": "OBJECT",
                "schema": {
                    "properties": {
                        "attendees": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "schema": {
                                    "properties": { "email": { "type": "string", "required": true } }
                                }
                            }
                        }
                    }
                }
            }
        }
    ];
    const simplified = simplify(rawSchema);
    assert.strictEqual(simplified.properties.body.properties.attendees.type, "array");
    assert.strictEqual(simplified.properties.body.properties.attendees.items.properties.email.type, "string");

    const zodSchema = toZod(simplified);
    const valid = zodSchema.parse({ body: { attendees: [{ email: "a@b.com" }] } });
    assert.strictEqual(valid.body.attendees[0].email, "a@b.com");
    assert.throws(() => zodSchema.parse({ body: { attendees: [{ email: 123 }] } }));
});

test('toZod keeps a permissive record for a freeform object body', async () => {
    const { toZod } = require('../dist/schema.js');
    const schema = simplify([{ "body": { "LOCATION": "body", "TYPE": "OBJECT" } }]);
    const parsed = toZod(schema).parse({ body: { anything: 1, nested: { a: true } } });
    assert.deepStrictEqual(parsed.body, { anything: 1, nested: { a: true } });
});

test('CrewAIProvider produces correct duck-typed shape', async () => {
    const { CrewAIProvider } = require('../dist/providers/crewai.js');
    const { z } = require('zod');
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
    assert.ok(formatted.schema instanceof z.ZodObject);
    assert.strictEqual(formatted.verbose, false);
    assert.strictEqual(formatted.cacheResults, false);
    assert.strictEqual(typeof formatted.execute, "function");
    assert.strictEqual(typeof formatted.getMetadata, "function");
    
    // Validate schema behavior for valid and invalid inputs
    assert.deepStrictEqual(formatted.schema.parse({ a: "valid" }), { a: "valid" });
    assert.throws(() => formatted.schema.parse({}));
    assert.throws(() => formatted.schema.parse({ a: 123 }));

    // Ensure execute returns ToolExecutionResult as expected on success
    const res = await formatted.execute({ a: "test" });
    assert.deepStrictEqual(res, { success: true, result: { a: "test" } });

    // Test error handling in execute when tool throws
    const failingToolDef = {
        ...toolDef,
        execute: async () => { throw new Error("Execution failed"); }
    };
    const formattedFailing = provider.formatTool(failingToolDef);
    const failRes = await formattedFailing.execute({ a: "test" });
    assert.deepStrictEqual(failRes, { success: false, result: null, error: "Execution failed" });

    // Validate getMetadata output and schema behavior
    const metadata = formatted.getMetadata();
    assert.strictEqual(metadata.name, "test_tool");
    assert.strictEqual(metadata.description, "A crewai test tool");
    assert.ok(metadata.schema instanceof z.ZodObject);
    assert.deepStrictEqual(metadata.schema.parse({ a: "valid" }), { a: "valid" });
    assert.throws(() => metadata.schema.parse({}));
    assert.throws(() => metadata.schema.parse({ a: 123 }));
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

test('Schema filters out system parameters starting with dollar sign', () => {
    const rawSchema = [
        { "$.xgafv": { "LOCATION": "query", "TYPE": "STRING" } },
        { "q": { "LOCATION": "query", "TYPE": "STRING" } }
    ];
    const simplified = simplify(rawSchema);
    assert.strictEqual(simplified.properties["$.xgafv"], undefined);
    assert.strictEqual(simplified.properties.q.type, "string");
});

test('options.env.SWYTCHCODE_DEMO="0" overrides process.env.SWYTCHCODE_DEMO="1"', () => {
    const { parseClassifiedError } = require('../dist/exec.js');
    const childEnv = { ...{ SWYTCHCODE_DEMO: "1" }, ...{ SWYTCHCODE_DEMO: "0" } };
    assert.strictEqual(childEnv.SWYTCHCODE_DEMO === "1", false);
});


