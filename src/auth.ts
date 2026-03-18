import fs from "fs";
import http from "http";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { TOKEN_PATH, ensureConfigDir, readCredentials, credentialsExist } from "./config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
];
const LOOPBACK_PORT = 3847;
const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}`;

function createOAuth2Client(): OAuth2Client {
  const { client_id, client_secret } = readCredentials();
  return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

function saveToken(client: OAuth2Client): void {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(client.credentials, null, 2));
}

/**
 * Starts a temporary local HTTP server to receive the OAuth redirect,
 * extracts the authorization code, and resolves the promise.
 */
function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${LOOPBACK_PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Authorization failed.</h2><p>You can close this tab.</p>");
        res.socket?.destroy();
        server.closeAllConnections?.();
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p>");
        res.socket?.destroy();
        server.closeAllConnections?.();
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h2>Missing authorization code.</h2>");
      }
    });

    server.listen(LOOPBACK_PORT, () => {});
    server.on("error", (err) => reject(new Error(`Could not start auth server on port ${LOOPBACK_PORT}: ${err.message}`)));
  });
}

export async function runAuthFlow(): Promise<OAuth2Client> {
  const client = createOAuth2Client();
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\nOpen this URL in your browser to authorize Skills Manager:\n");
  console.log(authUrl);
  console.log("\nWaiting for authorization...");

  const code = await waitForAuthCode();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  saveToken(client);
  return client;
}

export async function getAuthedEmail(client: OAuth2Client): Promise<string | null> {
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const res = await oauth2.userinfo.get();
    return res.data.email ?? null;
  } catch {
    return null;
  }
}

export function getAuthClient(): OAuth2Client {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`Not authenticated. Run "skillsmanager init" first.`);
  }
  const client = createOAuth2Client();
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  client.setCredentials(token);

  client.on("tokens", (newTokens) => {
    const merged = { ...client.credentials, ...newTokens };
    client.setCredentials(merged);
    saveToken(client);
  });

  return client;
}

export function hasToken(): boolean {
  return fs.existsSync(TOKEN_PATH);
}

export async function ensureAuth(): Promise<OAuth2Client> {
  if (!credentialsExist()) {
    throw new Error(
      "No credentials found. Run: skillsmanager setup google"
    );
  }
  if (!hasToken()) {
    console.log("Not authenticated — launching login...\n");
    return runAuthFlow();
  }
  return getAuthClient();
}
