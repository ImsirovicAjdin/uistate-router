/**
 * @uistate/router: integration tests via @uistate/event-test
 *
 * Tests the store-driven routing patterns: setMany for route state,
 * wildcard subscriptions for route changes, query patching, and
 * the ui.route.go store-driven navigation pattern.
 *
 * Note: DOM-dependent features (navigate, start, link interception)
 * cannot be tested in Node. These tests verify the state patterns
 * that the router writes to the store.
 */

import { createEventTest, runTests } from '@uistate/event-test';
import { createEventState } from '@uistate/core';

const results = runTests({

  // -- route state shape ---------------------------------------------

  'route state: setMany writes atomic route update': () => {
    const t = createEventTest({});
    t.store.setMany({
      'ui.route.view': 'home',
      'ui.route.path': '/',
      'ui.route.params': {},
      'ui.route.query': {},
      'ui.route.transitioning': false,
    });
    t.assertPath('ui.route.view', 'home');
    t.assertPath('ui.route.path', '/');
    t.assertShape('ui.route.params', {});
    t.assertShape('ui.route.query', {});
    t.assertPath('ui.route.transitioning', false);
  },

  'route state: navigate to user page': () => {
    const t = createEventTest({});
    t.store.setMany({
      'ui.route.view': 'user',
      'ui.route.path': '/users/42',
      'ui.route.params': { id: '42' },
      'ui.route.query': {},
      'ui.route.transitioning': false,
    });
    t.assertPath('ui.route.view', 'user');
    t.assertPath('ui.route.path', '/users/42');
    t.assertPath('ui.route.params', { id: '42' });
    t.assertType('ui.route.params', 'object');
  },

  'route state: navigate with query params': () => {
    const t = createEventTest({});
    t.store.setMany({
      'ui.route.view': 'search',
      'ui.route.path': '/search',
      'ui.route.params': {},
      'ui.route.query': { q: 'hello', page: '2' },
      'ui.route.transitioning': false,
    });
    t.assertPath('ui.route.query', { q: 'hello', page: '2' });
  },

  // -- wildcard subscription -----------------------------------------

  'route wildcard: fires on any route change': () => {
    const store = createEventState({});
    let fires = 0;
    store.subscribe('ui.route.*', () => { fires++; });

    store.setMany({
      'ui.route.view': 'home',
      'ui.route.path': '/',
      'ui.route.params': {},
      'ui.route.query': {},
      'ui.route.transitioning': false,
    });

    if (fires !== 5) throw new Error(`Expected 5 wildcard fires, got ${fires}`);
    store.destroy();
  },

  'route wildcard: batch reduces fire count': () => {
    const store = createEventState({});
    let fires = 0;
    store.subscribe('ui.route.*', () => { fires++; });

    store.batch(() => {
      store.set('ui.route.view', 'home');
      store.set('ui.route.path', '/');
      store.set('ui.route.params', {});
    });

    // batch deduplicates, each unique path fires once
    if (fires !== 3) throw new Error(`Expected 3 fires after batch, got ${fires}`);
    store.destroy();
  },

  // -- store-driven navigation (ui.route.go) -------------------------

  'store-driven nav: string go pattern': () => {
    const t = createEventTest({});
    // Simulate what the router does when it sees ui.route.go
    t.trigger('ui.route.go', '/about');
    t.assertPath('ui.route.go', '/about');
    t.assertType('ui.route.go', 'string');
  },

  'store-driven nav: object go pattern': () => {
    const t = createEventTest({});
    t.trigger('ui.route.go', { path: '/users/1', search: '?tab=posts' });
    t.assertPath('ui.route.go', { path: '/users/1', search: '?tab=posts' });
    t.assertType('ui.route.go', 'object');
  },

  'store-driven nav: query-only go pattern': () => {
    const t = createEventTest({});
    t.trigger('ui.route.go', { query: { tab: 'posts' } });
    t.assertType('ui.route.go', 'object');
  },

  'store-driven nav: go reset to null after processing': () => {
    const t = createEventTest({});
    t.trigger('ui.route.go', '/about');
    t.trigger('ui.route.go', null);
    t.assertPath('ui.route.go', null);
  },

  // -- transition state ----------------------------------------------

  'transition: transitioning flag lifecycle': () => {
    const t = createEventTest({});
    t.trigger('ui.route.transitioning', true);
    t.assertPath('ui.route.transitioning', true);
    t.assertType('ui.route.transitioning', 'boolean');

    t.trigger('ui.route.transitioning', false);
    t.assertPath('ui.route.transitioning', false);
  },

  // -- multi-param route state ---------------------------------------

  'multi-param: nested route params': () => {
    const t = createEventTest({});
    t.store.setMany({
      'ui.route.view': 'post',
      'ui.route.path': '/users/1/posts/99',
      'ui.route.params': { id: '1', postId: '99' },
      'ui.route.query': {},
    });
    t.assertPath('ui.route.params', { id: '1', postId: '99' });
    t.assertShape('ui.route.params', { id: 'string', postId: 'string' });
  },

  // -- sequential navigation -----------------------------------------

  'sequential nav: home → users → user': () => {
    const store = createEventState({});
    let viewChanges = [];
    store.subscribe('ui.route.view', (value) => { viewChanges.push(value); });

    store.setMany({ 'ui.route.view': 'home', 'ui.route.path': '/' });
    store.setMany({ 'ui.route.view': 'users', 'ui.route.path': '/users' });
    store.setMany({ 'ui.route.view': 'user', 'ui.route.path': '/users/42' });

    if (viewChanges.length !== 3) throw new Error(`Expected 3 view changes, got ${viewChanges.length}`);
    if (viewChanges[0] !== 'home') throw new Error('First view should be home');
    if (viewChanges[1] !== 'users') throw new Error('Second view should be users');
    if (viewChanges[2] !== 'user') throw new Error('Third view should be user');
    store.destroy();
  },

  // -- type assertions for type generation ---------------------------

  'types: route state shape for type generation': () => {
    const t = createEventTest({});
    t.store.setMany({
      'ui.route.view': 'home',
      'ui.route.path': '/',
      'ui.route.params': {},
      'ui.route.query': {},
      'ui.route.transitioning': false,
    });
    t.assertType('ui.route.view', 'string');
    t.assertType('ui.route.path', 'string');
    t.assertType('ui.route.transitioning', 'boolean');
    t.assertShape('ui.route.params', {});
    t.assertShape('ui.route.query', {});
  },
});

if (results.failed > 0) process.exit(1);
