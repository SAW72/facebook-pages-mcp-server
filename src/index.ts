import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { isInitializeRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const GRAPH_VERSION = 'v25.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const APP_ID = process.env.FACEBOOK_APP_ID || '';
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
const USER_TOKEN = process.env.FACEBOOK_USER_ACCESS_TOKEN || '';
const MCP_SECRET = process.env.MCP_SECRET || '';

// ---------------------------------------------------------------------------
// Graph API helpers
// ---------------------------------------------------------------------------
async function graphGet(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API ${res.status}: ${text}`);
  }
  return res.json();
}

async function graphPost(path: string, token: string, body: Record<string, unknown>) {
  const url = `${GRAPH_BASE}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API ${res.status}: ${text}`);
  }
  return res.json();
}

async function graphDelete(path: string, token: string) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString(), { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// MCP Server + tools
// ---------------------------------------------------------------------------
const transports: Record<string, StreamableHTTPServerTransport> = {};

function buildServer() {
  const server = new McpServer({
    name: 'facebook-pages-mcp-server',
    version: '1.0.0',
  });

  // list_pages
  server.registerTool(
    'list_pages',
    {
      description: 'List every Facebook Page the authenticated user manages, including each Page access token. Call this first to discover page IDs.',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      if (!USER_TOKEN) {
        return { content: [{ type: 'text', text: 'No FACEBOOK_USER_ACCESS_TOKEN set. Generate a long-lived user token with pages_show_list + pages_manage_posts via Graph API Explorer, or implement OAuth.' }], isError: true };
      }
      const data = await graphGet('me/accounts', USER_TOKEN, {
        fields: 'id,name,category,access_token,tasks',
      });
      const pages = (data.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        tasks: p.tasks,
        access_token: p.access_token,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
    }
  );

  // create_post
  server.registerTool(
    'create_post',
    {
      description: 'Publish a text, link, or photo post to a Facebook Page. Requires the Page access token from list_pages.',
      inputSchema: {
        page_id: z.string().describe('Facebook Page ID'),
        page_access_token: z.string().describe('Page access token from list_pages'),
        message: z.string().describe('Post text content'),
        link: z.string().optional().describe('Optional URL to share'),
        published: z.boolean().optional().describe('false to schedule (use scheduled_publish_time)'),
        scheduled_publish_time: z.number().optional().describe('Unix timestamp for scheduled posts'),
      },
    },
    async ({ page_id, page_access_token, message, link, published, scheduled_publish_time }): Promise<CallToolResult> => {
      const body: Record<string, unknown> = { message };
      if (link) body.link = link;
      if (published === false) body.published = false;
      if (scheduled_publish_time) body.scheduled_publish_time = scheduled_publish_time;
      const result = await graphPost(`${page_id}/feed`, page_access_token, body);
      return { content: [{ type: 'text', text: `Post created: ${JSON.stringify(result)}` }] };
    }
  );

  // get_posts
  server.registerTool(
    'get_posts',
    {
      description: 'List recent posts published by a Page.',
      inputSchema: {
        page_id: z.string(),
        page_access_token: z.string(),
        limit: z.number().optional().default(10),
      },
    },
    async ({ page_id, page_access_token, limit }): Promise<CallToolResult> => {
      const data = await graphGet(`${page_id}/posts`, page_access_token, {
        fields: 'id,message,created_time,permalink_url,shares,reactions.summary(true)',
        limit: String(limit),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data.data || [], null, 2) }] };
    }
  );

  // delete_post
  server.registerTool(
    'delete_post',
    {
      description: 'Delete a post by its ID.',
      inputSchema: {
        post_id: z.string(),
        page_access_token: z.string(),
      },
    },
    async ({ post_id, page_access_token }): Promise<CallToolResult> => {
      await graphDelete(post_id, page_access_token);
      return { content: [{ type: 'text', text: `Deleted post ${post_id}` }] };
    }
  );

  // get_comments
  server.registerTool(
    'get_comments',
    {
      description: 'List comments on a specific post.',
      inputSchema: {
        post_id: z.string(),
        page_access_token: z.string(),
        limit: z.number().optional().default(25),
      },
    },
    async ({ post_id, page_access_token, limit }): Promise<CallToolResult> => {
      const data = await graphGet(`${post_id}/comments`, page_access_token, {
        fields: 'id,message,created_time,from{name,id},like_count',
        limit: String(limit),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data.data || [], null, 2) }] };
    }
  );

  // reply_comment
  server.registerTool(
    'reply_comment',
    {
      description: 'Reply to a comment as the Page.',
      inputSchema: {
        comment_id: z.string(),
        page_access_token: z.string(),
        message: z.string(),
      },
    },
    async ({ comment_id, page_access_token, message }): Promise<CallToolResult> => {
      const result = await graphPost(`${comment_id}/comments`, page_access_token, { message });
      return { content: [{ type: 'text', text: `Reply posted: ${JSON.stringify(result)}` }] };
    }
  );

  // get_page_insights
  server.registerTool(
    'get_page_insights',
    {
      description: 'Fetch Page-level analytics (fans, views, engagement).',
      inputSchema: {
        page_id: z.string(),
        page_access_token: z.string(),
        metric: z.string().optional().default('page_fans,page_views_total,page_post_engagements'),
        period: z.enum(['day', 'week', 'days_28']).optional().default('day'),
      },
    },
    async ({ page_id, page_access_token, metric, period }): Promise<CallToolResult> => {
      const data = await graphGet(`${page_id}/insights`, page_access_token, { metric, period });
      return { content: [{ type: 'text', text: JSON.stringify(data.data || [], null, 2) }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Express + Streamable HTTP transport
// ---------------------------------------------------------------------------
const app = createMcpExpressApp();

if (MCP_SECRET) {
  app.use((req, res, next) => {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${MCP_SECRET}`) {
      res.status(401).send('Unauthorized');
      return;
    }
    next();
  });
}

app.get('/health', (_req, res) => res.json({ status: 'ok', base: BASE_URL }));

app.all('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && transports[sid]) delete transports[sid];
    };
    const server = buildServer();
    await server.connect(transport);
  } else {
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session' }, id: null });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, HOST, () => {
  console.log(`Facebook Pages MCP server listening on ${BASE_URL}/mcp`);
  console.log(`Health: ${BASE_URL}/health`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  for (const sid of Object.keys(transports)) {
    try { await transports[sid].close(); } catch {}
    delete transports[sid];
  }
  process.exit(0);
});
