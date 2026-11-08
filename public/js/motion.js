'use strict';
// GIS shared motion module. Self-contained, framework-free: a page includes
// it with <script src="/js/motion.js" defer></script> and gets, automatically,
// based on markup conventions already used across the site:
//   - reveal:    any ".rv" element fades up 22px over 900ms, once, at 20% in
//                view. Elements sharing a "data-reveal-group" value stagger
//                110ms apart in document order (used for statement rise too,
//                since ".claim .statement"'s own transform lives in CSS and
//                only needs the ancestor's ".is-in" class).
//   - cursor:    a decorative 88px circle follows the pointer and shows a
//                label on any element with "data-cursor" (e.g. data-cursor="Read").
//                Only on pointer:fine, never under reduced motion. The native
//                cursor and focus outline are untouched.
//   - wipe:      internal link navigation gets a blue block-wipe transition,
//                unless the browser supports cross-document View Transitions
//                (in which case the page's own "@view-transition { navigation:
//                auto }" CSS handles it instead and this module steps aside),
//                or the visitor prefers reduced motion (plain navigation).
//   - nav scroll: the masthead shrinks/hides on scroll, same timings as the
//                design system's Masthead component.
//   - Lenis:     smooth scroll, wired to GSAP's ScrollTrigger when present.
//                Off under reduced motion and below the 860px breakpoint,
//                where the design calls for native scrolling.
// Page-specific choreography (the issue strip's pin, the hero's letter
// stagger, mouse parallax) stays on the page itself, built with the globals
// this module leaves in place (gsap, ScrollTrigger, Lenis) plus the flags on
// window.GISMotion — see build/pages/index.html for the first consumer.
(function () {
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isMobile = matchMedia('(max-width: 860px)').matches;

  // ── Reveal (fade + 22px lift, 20% in view, once; staggered by group) ──────
  function initReveal() {
    var els = document.querySelectorAll('.rv');
    if (!els.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        io.unobserve(el);
        var group = el.getAttribute('data-reveal-group');
        var delay = 0;
        if (group && !reduced) {
          var members = document.querySelectorAll('[data-reveal-group="' + group + '"]');
          delay = Array.prototype.indexOf.call(members, el) * 110;
        }
        if (delay > 0) setTimeout(function () { el.classList.add('is-in'); }, delay);
        else el.classList.add('is-in');
      });
    }, { threshold: .2 });
    els.forEach(function (el) { io.observe(el); });
  }

  // ── Cursor label ───────────────────────────────────────────────────────────
  function initCursor() {
    if (reduced || !matchMedia('(pointer: fine)').matches) return;
    var targets = document.querySelectorAll('[data-cursor]');
    if (!targets.length) return;

    var el = document.createElement('div');
    el.id = 'gis-cursor';
    el.setAttribute('aria-hidden', 'true');
    var label = document.createElement('span');
    el.appendChild(label);
    document.body.appendChild(el);

    var style = document.createElement('style');
    style.textContent = '#gis-cursor{position:fixed;top:0;left:0;width:88px;height:88px;' +
      'margin:-44px 0 0 -44px;border-radius:50%;background:#fff;color:var(--ink);' +
      'display:flex;align-items:center;justify-content:center;text-align:center;' +
      'font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;' +
      'pointer-events:none;z-index:300;opacity:0;transform:scale(.6);' +
      'transition:opacity .25s var(--ease),transform .25s var(--ease);will-change:transform}' +
      '#gis-cursor.is-on{opacity:1;transform:scale(1)}';
    document.head.appendChild(style);

    var x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, raf = null;
    addEventListener('pointermove', function (e) { x = e.clientX; y = e.clientY; });

    function tick() {
      cx += (x - cx) * .18;
      cy += (y - cy) * .18;
      el.style.left = cx + 'px';
      el.style.top = cy + 'px';
      raf = requestAnimationFrame(tick);
    }
    tick();

    document.addEventListener('pointerover', function (e) {
      var target = e.target.closest && e.target.closest('[data-cursor]');
      if (!target) return;
      label.textContent = target.getAttribute('data-cursor');
      el.classList.add('is-on');
    });
    document.addEventListener('pointerout', function (e) {
      var leavingTarget = e.target.closest && e.target.closest('[data-cursor]');
      if (!leavingTarget) return;
      var enteringTarget = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-cursor]');
      if (enteringTarget === leavingTarget) return;
      el.classList.remove('is-on');
    });
  }

  // ── Masthead scroll shrink/hide ────────────────────────────────────────────
  function initNavScroll() {
    var nav = document.querySelector('nav');
    if (!nav) return;
    var lastY = scrollY;
    function onScroll() {
      var y = scrollY;
      nav.classList.toggle('solid', y > 40);
      nav.classList.toggle('hide', y > innerHeight * 0.7 && y > lastY);
      lastY = y;
    }
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
  }

  // ── Block wipe (internal nav only), stepping aside for native cross-document
  // View Transitions where the browser supports them ──────────────────────────
  function supportsCrossDocViewTransitions() {
    return 'onpageswap' in window;
  }
  function initWipe() {
    if (reduced) return;
    if (supportsCrossDocViewTransitions()) return; // the page's own CSS handles it natively
    var wipe = document.createElement('div');
    wipe.id = 'wipe';
    wipe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(wipe);
    var style = document.createElement('style');
    style.textContent = '#wipe{position:fixed;inset:0;background:var(--blue);z-index:400;' +
      'transform:scaleY(0);transform-origin:bottom;pointer-events:none}' +
      '#wipe.go{animation:gis-wipe 900ms var(--ease) forwards}' +
      '@keyframes gis-wipe{0%{transform:scaleY(0);transform-origin:bottom}' +
      '45%{transform:scaleY(1);transform-origin:bottom}' +
      '55%{transform:scaleY(1);transform-origin:top}' +
      '100%{transform:scaleY(0);transform-origin:top}}';
    document.head.appendChild(style);

    document.querySelectorAll('a[href]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        if (ev.defaultPrevented || ev.button !== 0) return;
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        if (a.target === '_blank' || a.hasAttribute('download')) return;
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#') return;
        if (a.origin !== location.origin) return;
        ev.preventDefault();
        wipe.classList.add('go');
        setTimeout(function () { location.href = a.href; }, 430);
      });
    });
  }

  // ── Lenis smooth scroll, wired to ScrollTrigger when present ──────────────
  function initLenis() {
    if (reduced || isMobile || typeof Lenis === 'undefined') return null;
    var lenis = new Lenis({ smoothWheel: true });
    if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    } else {
      (function raf(time) { lenis.raf(time); requestAnimationFrame(raf); })(performance.now());
    }
    return lenis;
  }

  function boot() {
    initReveal();
    initCursor();
    initNavScroll();
    initWipe();
    window.GISMotion = {
      reduced: reduced,
      isMobile: isMobile,
      supportsCrossDocViewTransitions: supportsCrossDocViewTransitions(),
      lenis: initLenis(),
    };
    document.dispatchEvent(new CustomEvent('gis-motion:ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
