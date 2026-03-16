import fs from "fs";
import readline from "readline";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { TOKEN_PATH, ensureConfigDir, readCredentials, credentialsExist } from "./config.js";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

function createOAuth2Client(): OAuth2Client {
  const { client_id, client_secret } = readCredentials();
  return new google.auth.OAuth2(
    client_id,
    client_secret,
    "urn:ietf:wg:oauth:2.0:oob"
  );
}

function saveToken(client: OAuth2Client): void {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(client.credentials, null, 2));
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
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
  console.log();

  const code = await prompt("Paste the authorization code here: ");
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  saveToken(client);
  return client;
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
