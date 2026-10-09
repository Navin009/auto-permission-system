import { readFileSync } from 'node:fs';
import { evaluateMcpCall } from '../../../src/detect/index.ts';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

let tools = [];
try { tools = JSON.parse(readFileSync(new URL('../fixtures/mcp-tools.json', import.meta.url), 'utf8')); } catch { tools = []; }
const descriptionOf = new Map(tools.map((t) => [t.name, t.description]));

const run = (name, args = {}, extras = {}) =>
  evaluateMcpCall({
    tool: { name, description: extras.description ?? descriptionOf.get(name), annotations: extras.annotations },
    call: { name, arguments: args },
    policy: extras.policy,
  });

check('query_prometheus allows', run('mcp__grafana__query_prometheus').decision === 'allow');
check('get_task_by_id allows', run('mcp__ticktick__get_task_by_id').decision === 'allow');
check('take_screenshot allows', run('mcp__chrome_devtools__take_screenshot').decision === 'allow');
check('search_tools allows (server name "dev_link" is not the operation)', run('mcp__dev_link__search_tools').decision === 'allow');
check('logs allows', run('mcp__diffusion_studio__logs').decision === 'allow');
check('context allows (documented, unclassified name)', run('mcp__diffusion_studio__context').decision === 'allow');
check('export allows (unclassified name, not destructive)', run('mcp__diffusion_studio__export').decision === 'allow');
check('list_loki_label_names allows ("label" is a noun)', run('mcp__grafana__list_loki_label_names').decision === 'allow');
check('ads_catalog_list_product_sets allows ("set" is a noun)', run('mcp__facebook_ads__ads_catalog_list_product_sets').decision === 'allow');
check('list_provisioning_repositories allows ("provisioning" is a noun)', run('mcp__grafana__list_provisioning_repositories').decision === 'allow');

const adAccounts = run('mcp__facebook_ads__ads_get_ad_accounts', {}, { annotations: { readOnlyHint: true } });
check('get_ad_accounts allows with readOnlyHint', adAccounts.decision === 'allow');
check('get_ad_accounts is not destructive', adAccounts.classification !== 'destructive');

for (const name of [
  'mcp__argocd__delete_application',
  'mcp__ticktick__delete_task',
  'mcp__ticktick__update_task',
  'mcp__grafana__update_dashboard',
  'mcp__argocd__sync_application',
  'mcp__chrome_devtools__evaluate_script',
  'mcp__tinyfish__run_web_automation',
]) {
  check(`${name} asks`, run(name).decision === 'ask');
}
check('delete_application is destructive', run('mcp__argocd__delete_application').classification === 'destructive');
check('readOnlyHint cannot excuse a delete', run('mcp__ticktick__delete_task', {}, { annotations: { readOnlyHint: true } }).decision === 'ask');

const sqlDelete = run('mcp__dev_link__read_mysql_execute_query', { query: 'DELETE FROM users WHERE 1=1' }, { description: 'Execute a read-only MySQL query.' });
check('a read_query tool handed DELETE asks', sqlDelete.decision === 'ask');
check('destructive arguments override the read name', sqlDelete.classification === 'destructive');
check('a SELECT query stays allowed', run('mcp__dev_link__read_mysql_execute_query', { query: 'SELECT * FROM users LIMIT 1' }, { description: 'Execute a read-only MySQL query.' }).decision === 'allow');
check('HTTP DELETE asks', run('mcp__grafana__grafana_api_request', { method: 'DELETE', url: '/api/dashboards/uid/x' }).decision === 'ask');
check('a shell rm asks', run('mcp__x__run_command', { command: 'rm -rf /tmp/x' }, { description: 'Run a shell command.' }).decision === 'ask');
check('a wildcard target asks', run('mcp__x__delete_files', { path: '*' }, { description: 'Delete files.' }).decision === 'ask');
check('a production target asks', run('mcp__x__deploy_app', { environment: 'production' }, { description: 'Deploy the app.' }).decision === 'ask');
check('batch arrays ask', run('mcp__x__update_task', { ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, { description: 'Update one task.' }).decision === 'ask');

check('filter "all" is not a wildcard', run('mcp__x__list_files', { filter: 'all' }, { description: 'List files.' }).decision === 'allow');
check('a path segment "live" is not production', run('mcp__x__read_file', { path: 'src/live/handler.ts' }, { description: 'Read a file.' }).decision === 'allow');

check('a tool with no description asks', run('mcp__x__frobnicate', {}, { description: undefined }).decision === 'ask');

check('allowTools skips the delete ask', run('mcp__ticktick__delete_task', {}, { policy: { allowTools: ['mcp__ticktick__delete_task'] } }).decision === 'allow');
check('allowPrefixes matches a family', run('mcp__ticktick__get_task_by_id', {}, { policy: { allowPrefixes: ['mcp__ticktick__get_'] } }).decision === 'allow');
check('askTools forces an ask', run('mcp__ticktick__get_task_by_id', {}, { policy: { askTools: ['mcp__ticktick__get_task_by_id'] } }).decision === 'ask');
check('askTools wins when a name is in both lists', run('mcp__ticktick__get_task_by_id', {}, { policy: { allowTools: ['mcp__ticktick__get_task_by_id'], askTools: ['mcp__ticktick__get_task_by_id'] } }).decision === 'ask');
check('trustAnnotations allows a read hint', run('mcp__x__frobnicate', {}, { annotations: { readOnlyHint: true }, policy: { trustAnnotations: true } }).decision === 'allow');
check('a higher askThreshold lets a simple update through', run('mcp__ticktick__update_task', {}, { policy: { askThreshold: 100 } }).decision === 'allow');
check('a lower askThreshold makes an unclassified read ask', run('mcp__diffusion_studio__context', {}, { policy: { askThreshold: 10 } }).decision === 'ask');

console.log(`PASS=${pass}, FAIL=${fail}`);
process.exit(fail ? 1 : 0);
