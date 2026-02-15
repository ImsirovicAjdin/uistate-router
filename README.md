# @uistate/router

SPA router for EventState stores. Routing is just state.

`navigate()` writes to store paths. Components subscribe. No framework required.

## Install

```bash
npm install @uistate/router
```

## Quick Start

```js
import { createEventState } from '@uistate/core';
import { createRouter } from '@uistate/router';

const store = createEventState({ state: {} });

const router = createRouter({
  routes: [
    { path: '/', view: 'home', component: HomeView },
    { path: '/users', view: 'users', component: UsersView },
    { path: '/users/:id', view: 'user', component: UserView },
    { path: '/users/:id/posts/:postId', view: 'post', component: PostView },
  ],
  store,
  fallback: { path: '/*', view: '404', component: NotFoundView },
  debug: true,
});

router.start();
```

## How It Works

Every navigation writes to the store:

| Store Path | Value |
|---|---|
| `ui.route.view` | The matched `view` string (e.g. `'user'`) |
| `ui.route.path` | The normalized path (e.g. `'/users/42'`) |
| `ui.route.params` | Extracted params (e.g. `{ id: '42' }`) |
| `ui.route.query` | Parsed query params (e.g. `{ tab: 'posts' }`) |
| `ui.route.transitioning` | `true` during navigation, `false` after |

Your components subscribe to these paths like any other state:

```js
store.subscribe('ui.route.view', (view) => {
  console.log('View changed to:', view);
});

store.subscribe('ui.route.params', (params) => {
  console.log('Route params:', params);
});

// Wildcard: react to any route change
store.subscribe('ui.route.*', ({ path, value }) => {
  console.log('Route state changed:', path, value);
});
```

## Route Patterns

Routes support static paths and dynamic `:param` segments:

```js
{ path: '/',                view: 'home' }       // exact match
{ path: '/users',           view: 'users' }      // exact match
{ path: '/users/:id',       view: 'user' }       // dynamic segment
{ path: '/posts/:id/edit',  view: 'edit-post' }  // mixed
```

Params are extracted and available at `ui.route.params`:

```js
// URL: /users/42
store.get('ui.route.params');  // { id: '42' }
```

## View Components

A view component is any object with a `boot` method:

```js
const UserView = {
  async boot({ store, el, signal, params }) {
    el.innerHTML = `<h1>User ${params.id}</h1>`;

    // Use signal for cleanup-aware async work
    const res = await fetch(`/api/users/${params.id}`, { signal });
    const user = await res.json();
    el.innerHTML = `<h1>${user.name}</h1>`;

    // Return an unboot function for cleanup
    return () => {
      console.log('UserView unmounted');
    };
  }
};
```

The `boot` function receives:

| Param | Description |
|---|---|
| `store` | The EventState store instance |
| `el` | The root DOM element (from `rootSelector`) |
| `signal` | An `AbortSignal` — aborted if the user navigates away before boot finishes |
| `params` | Extracted route params (e.g. `{ id: '42' }`) |

## API

### `createRouter(config)`

Returns a router instance.

**Config options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `routes` | `Array` | `[]` | Route definitions |
| `store` | `Object` | — | EventState store |
| `rootSelector` | `string` | `'[data-route-root]'` | CSS selector for the mount point |
| `fallback` | `Object` | `null` | Fallback route for unmatched paths |
| `debug` | `boolean` | `false` | Log navigation to console |
| `linkSelector` | `string` | `'a[data-link]'` | Selector for intercepted link clicks |

### Router Instance

#### `router.start()`

Starts listening for link clicks and popstate events. Immediately navigates to the current URL.

#### `router.stop()`

Removes event listeners and calls the current view's unboot function.

#### `router.navigate(pathname, opts?)`

Programmatic navigation.

```js
router.navigate('/users/42');
router.navigate('/search', { search: '?q=hello' });
router.navigate('/users', { replace: true });
```

Options: `{ replace, search, restoreScroll }`

#### `router.navigateQuery(patch, opts?)`

Patch query parameters without changing the path.

```js
router.navigateQuery({ tab: 'posts' });           // add/update
router.navigateQuery({ tab: null });               // remove
router.navigateQuery({ page: '2', sort: 'name' }); // multiple
```

#### `router.getCurrent()`

Returns `{ view, path, search }` for the current route.

## Link Interception

Any `<a>` matching `linkSelector` (default: `a[data-link]`) is intercepted for client-side navigation:

```html
<nav>
  <a href="/" data-link>Home</a>
  <a href="/users" data-link>Users</a>
  <a href="/users/42" data-link>User 42</a>
</nav>

<div data-route-root></div>
```

Standard browser behavior is preserved for:
- External links (different origin)
- Modified clicks (Ctrl, Cmd, Shift, Alt, right-click)
- Links without `data-link`

## Active Nav (Subscribe, Don't Bake In)

The router does **not** manage active nav styles. Instead, subscribe to the route path and manage your own UI:

```js
store.subscribe('ui.route.path', (path) => {
  document.querySelectorAll('nav a[data-link]').forEach(a => {
    const href = new URL(a.getAttribute('href'), location.href).pathname;
    a.classList.toggle('active', href === path);
  });
});
```

This keeps the router focused on state. Your nav, your rules.

## Base Path Support

If your app is served from a subdirectory, add a `<base>` tag:

```html
<base href="/my-app/">
```

The router automatically detects it and adjusts all path operations.

## Scroll Restoration

The router saves scroll positions per route and restores them on back/forward navigation. Forward navigation scrolls to top.

## Accessibility

On every navigation, the router:
1. Sets `tabindex="-1"` on the root element (if not already set)
2. Focuses the root element (with `preventScroll`)

This ensures screen readers announce the new content.

## CSS Hooks

The router sets attributes on `<html>` for CSS-driven transitions:

```css
/* Style based on current view */
[data-view="home"] .hero { display: block; }
[data-view="user"] .sidebar { display: flex; }

/* Transition states */
[data-transitioning="on"] [data-route-root] {
  opacity: 0.5;
  pointer-events: none;
}
```

## Testing

Two-layer testing architecture:

**`self-test.js`** — Zero-dependency self-test (35 assertions). Runs automatically on `npm install` via `postinstall`. Tests the pure-function core: pattern compilation, path normalization, route resolution, and URL-encoded param decoding.

```bash
node self-test.js
```

**`tests/router.test.js`** — Integration tests via `@uistate/event-test` (13 tests). Tests the store-driven routing patterns: `setMany` for atomic route updates, wildcard subscriptions, `ui.route.go` navigation, transition state, and type generation.

```bash
npm test
```

| Suite | Assertions | Dependencies |
|-------|-----------|-------------|
| `self-test.js` | 35 | none (zero-dep) |
| `tests/router.test.js` | 13 | `@uistate/event-test`, `@uistate/core` |

## Philosophy

Routing is not special. It's a `set` call to a path in a JSON tree. The router writes `ui.route.*`, and anything that cares about routing subscribes to `ui.route.*`. The router doesn't know about your nav, your breadcrumbs, your analytics, or your loading spinners. They all subscribe independently. That's UIState: EventState + Routing.

## License

MIT
