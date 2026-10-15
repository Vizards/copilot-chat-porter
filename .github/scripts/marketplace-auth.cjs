// Read-only authentication checks. This script never uploads an extension.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');

const publisher = 'Vizards';
const extension = 'copilot-chat-porter';
const repository = `${publisher}/${extension}`;
const audience = 'api://AzureADTokenExchange';

function requireEnv(name) {
  const value = process.env[name];
  assert(value, `Missing ${name}`);
  return value;
}

function report(label, value) {
  const line = `${label}: ${JSON.stringify(value)}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n\n`);
  }
}

async function readJson(url, token, scheme = 'Bearer') {
  const response = await fetch(url, {
    headers: { Authorization: `${scheme} ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const code = String(body.typeKey || body.errorCode || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100);
    throw new Error(`${new URL(url).hostname} returned HTTP ${response.status} ${code}`);
  }
  return response.json();
}

function azureJson(args) {
  try {
    return JSON.parse(execFileSync('az', [...args, '--output', 'json'], {
      encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch {
    throw new Error(`Azure CLI ${args.slice(0, 2).join(' ')} failed; token output withheld`);
  }
}

async function checkClaims() {
  const url = new URL(requireEnv('ACTIONS_ID_TOKEN_REQUEST_URL'));
  url.searchParams.set('audience', audience);
  const result = await readJson(url, requireEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN'));
  assert(typeof result.value === 'string', 'GitHub did not return an OIDC token');
  console.log(`::add-mask::${result.value}`);
  const claims = JSON.parse(Buffer.from(result.value.split('.')[1], 'base64url').toString());
  const expected = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: audience,
    sub: `repo:${repository}:environment:production`,
    repository,
    repository_id: '1175235715',
    repository_owner_id: '13443193',
    ref: 'refs/heads/main',
    environment: 'production',
    workflow_ref: `${repository}/.github/workflows/marketplace-auth.yml@refs/heads/main`,
  };
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(claims[name], value, `Unexpected GitHub OIDC ${name}`);
  }
  report('Verified GitHub identity', expected);
}

async function checkMarketplace(mode) {
  const clientId = requireEnv('AZURE_CLIENT_ID');
  const tenantId = requireEnv('AZURE_TENANT_ID');
  const account = azureJson(['account', 'show']);
  assert.equal(account.tenantId, tenantId, 'Azure tenant does not match');
  assert.equal(account.user?.type, 'servicePrincipal', 'Expected a service principal login');
  assert.equal(account.user?.name?.toLowerCase(), clientId.toLowerCase(), 'Unexpected Azure client identity');
  const credential = azureJson(['account', 'get-access-token', '--resource', '499b84ac-1321-427f-aa17-267ca6975798']);
  assert(credential.accessToken, 'Azure did not return an access token');
  console.log(`::add-mask::${credential.accessToken}`);
  const profile = await readJson('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1', credential.accessToken);
  assert.match(profile.id || '', /^[0-9a-f-]{36}$/i, 'Marketplace profile ID is missing');
  assert.equal(profile.displayName, 'porter-marketplace-publisher', 'Unexpected Marketplace profile name');
  report('Marketplace profile', { id: profile.id, displayName: profile.displayName });
  if (mode === 'profile') {
    report('Setup result', 'Profile lookup only; publisher permission is NOT verified. Run full after assigning Contributor.');
    return;
  }

  const { WebApi, getBearerHandler } = require('azure-devops-node-api');
  const api = new WebApi('https://marketplace.visualstudio.com', getBearerHandler(credential.accessToken), {
    socketTimeout: 30_000, allowRetries: false,
  });
  let assignments;
  try {
    const security = await api.getSecurityRolesApi();
    assignments = await security.getRoleAssignments('gallery.publisher', publisher);
  } catch (error) {
    throw new Error(`Marketplace role lookup failed (HTTP ${Number(error.statusCode) || 'unknown'})`);
  }
  const ownAssignments = assignments.filter(item => item.identity?.id === profile.id);
  assert(ownAssignments.some(item => ['Contributor', 'Owner'].includes(item.role?.name)), 'This profile is not a publisher Contributor or Owner');
  report('Verified publisher roles', ownAssignments.map(item => ({ identityId: item.identity.id, role: item.role.name })));

  let published;
  try {
    const gallery = await api.getGalleryApi();
    published = await gallery.getExtension(undefined, publisher, extension);
  } catch (error) {
    throw new Error(`Marketplace extension lookup failed (HTTP ${Number(error.statusCode) || 'unknown'})`);
  }
  assert.equal(published.publisher?.publisherName?.toLowerCase(), publisher.toLowerCase(), 'Wrong publisher returned');
  assert.equal(published.extensionName, extension, 'Wrong extension returned');
  report('Verified extension', `${published.publisher.publisherName}.${published.extensionName}`);
}

async function main() {
  assert(!process.env.VSCE_PAT, 'VSCE_PAT must not be injected into this workflow');
  const mode = process.argv[2];
  assert(['claims', 'profile', 'full'].includes(mode), 'Expected claims, profile, or full');
  if (mode === 'claims') await checkClaims();
  else await checkMarketplace(mode);
}

if (require.main === module) {
  main().catch(error => {
    // Do not dump SDK response objects, request headers, or token-bearing CLI output.
    console.error(error.message);
    process.exitCode = 1;
  });
}
