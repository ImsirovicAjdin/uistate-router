/**
 * @uistate/router: zero-dependency self-test
 *
 * Tests the pure-function core of the router: pattern compilation,
 * path normalization, and route resolution.
 * DOM-dependent features (navigate, start, link interception) are
 * tested in the integration test suite.
 */

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// -- Pure functions extracted from router.js for testing -------------

function compilePattern(pattern) {
  const paramNames = [];
  const parts = pattern.split(/:([a-zA-Z_][a-zA-Z0-9_]*)/);
  const regexStr = parts
    .map((part, i) => {
      if (i % 2 === 1) {
        paramNames.push(part);
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return { regex: new RegExp('^' + regexStr + '$'), paramNames };
}

function normalizePath(p) {
  if (!p) return '/';
  if (p[0] !== '/') p = '/' + p;
  if (p === '/index.html') return '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function resolve(compiled, compiledFallback, pathname) {
  const p = normalizePath(pathname);
  for (const route of compiled) {
    const match = p.match(route.regex);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return { path: route.path, view: route.view, params };
    }
  }
  if (compiledFallback) return { ...compiledFallback, params: {} };
  return null;
}

// -- 1. compilePattern -----------------------------------------------

section('1. compilePattern');

const r1 = compilePattern('/');
assert('root: matches /', r1.regex.test('/'));
assert('root: no params', r1.paramNames.length === 0);
assert('root: rejects /foo', !r1.regex.test('/foo'));

const r2 = compilePattern('/users');
assert('static: matches /users', r2.regex.test('/users'));
assert('static: rejects /users/1', !r2.regex.test('/users/1'));
assert('static: rejects /', !r2.regex.test('/'));

const r3 = compilePattern('/users/:id');
assert('single param: matches /users/42', r3.regex.test('/users/42'));
assert('single param: extracts id', r3.paramNames[0] === 'id');
const m3 = '/users/42'.match(r3.regex);
assert('single param: id = 42', m3[1] === '42');
assert('single param: rejects /users', !r3.regex.test('/users'));
assert('single param: rejects /users/', !r3.regex.test('/users/'));

const r4 = compilePattern('/users/:id/posts/:postId');
assert('multi param: matches /users/1/posts/99', r4.regex.test('/users/1/posts/99'));
assert('multi param: paramNames', r4.paramNames[0] === 'id' && r4.paramNames[1] === 'postId');
const m4 = '/users/1/posts/99'.match(r4.regex);
assert('multi param: id = 1', m4[1] === '1');
assert('multi param: postId = 99', m4[2] === '99');

const r5 = compilePattern('/posts/:id/edit');
assert('mixed: matches /posts/5/edit', r5.regex.test('/posts/5/edit'));
assert('mixed: rejects /posts/5', !r5.regex.test('/posts/5'));

// -- 2. normalizePath ------------------------------------------------

section('2. normalizePath');

assert('null → /', normalizePath(null) === '/');
assert('empty → /', normalizePath('') === '/');
assert('/ → /', normalizePath('/') === '/');
assert('/users → /users', normalizePath('/users') === '/users');
assert('/users/ → /users', normalizePath('/users/') === '/users');
assert('users → /users', normalizePath('users') === '/users');
assert('/index.html → /', normalizePath('/index.html') === '/');
assert('/a/b/c/ → /a/b/c', normalizePath('/a/b/c/') === '/a/b/c');

// -- 3. resolve ------------------------------------------------------

section('3. resolve');

const routes = [
  { path: '/', view: 'home' },
  { path: '/users', view: 'users' },
  { path: '/users/:id', view: 'user' },
  { path: '/users/:id/posts/:postId', view: 'post' },
].map(r => ({ ...r, ...compilePattern(r.path) }));

const fallback = { view: '404', params: {} };

const res1 = resolve(routes, fallback, '/');
assert('resolve /: view = home', res1.view === 'home');

const res2 = resolve(routes, fallback, '/users');
assert('resolve /users: view = users', res2.view === 'users');

const res3 = resolve(routes, fallback, '/users/42');
assert('resolve /users/42: view = user', res3.view === 'user');
assert('resolve /users/42: params.id = 42', res3.params.id === '42');

const res4 = resolve(routes, fallback, '/users/1/posts/99');
assert('resolve /users/1/posts/99: view = post', res4.view === 'post');
assert('resolve /users/1/posts/99: params.id = 1', res4.params.id === '1');
assert('resolve /users/1/posts/99: params.postId = 99', res4.params.postId === '99');

const res5 = resolve(routes, fallback, '/unknown');
assert('resolve /unknown: falls back to 404', res5.view === '404');

const res6 = resolve(routes, null, '/unknown');
assert('resolve /unknown no fallback: returns null', res6 === null);

// -- 4. URL-encoded params -------------------------------------------

section('4. URL-encoded params');

const res7 = resolve(routes, null, '/users/hello%20world');
assert('URL-encoded param decoded', res7.params.id === 'hello world');

// -- Summary ---------------------------------------------------------

console.log(`\n@uistate/router v1.0.1 self-test`);
if (failed > 0) {
  console.error(`✗ ${failed} assertion(s) failed, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`✓ ${passed} assertions passed`);
}
