# Facebook Pages MCP Server

MCP server that lets Grok, Claude, or any MCP client create, edit, and manage organic content across **all Facebook Pages you own or manage**.

No official Meta MCP server exists for Pages content — this wraps the Graph API.

## Features

- **List all managed Pages** (with Page access tokens)
- **Create posts** (text, link, photo)
- **List / get / delete posts**
- **Read comments, reply, hide**
- **Page & post insights**
- **Streamable HTTP transport** — connect remotely from Grok (grok.com/connectors)

## Permissions needed (in your Meta app)

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `pages_manage_engagement` (for comments)
- `read_insights` (optional)
- `business_management` (recommended if Pages are in Business Manager)

## Quick start

```bash
npm install
cp .env.example .env   # fill in your app ID + secret
npm run dev
```

Server listens on `http://localhost:3000/mcp`.

## Connect to Grok

1. Tunnel locally: `ngrok http 3000` (or deploy to Railway/Render/Fly).
2. Go to grok.com/connectors → New Connector → Custom.
3. Paste the public URL: `https://your-tunnel.ngrok.io/mcp`
4. Authorize with your Meta login when prompted.

## Deploy (Railway example)

1. Push this repo to GitHub.
2. New project on Railway → deploy from GitHub.
3. Add env vars: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `PORT`.
4. Use the public URL + `/mcp` in Grok.

## Tools

| Tool | Description |
|------|-------------|
| `list_pages` | List every Page you manage + tokens |
| `create_post` | Publish text/link/photo to a Page |
| `get_posts` | Recent posts on a Page |
| `delete_post` | Remove a post by ID |
| `get_comments` | Comments on a post |
| `reply_comment` | Reply to a comment |
| `get_page_insights` | Page analytics |
| `get_post_insights` | Per-post engagement |

## License

MIT
