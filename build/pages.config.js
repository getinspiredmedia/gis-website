'use strict';

module.exports = [
  {
    input:  'build/pages/index.html',
    output: 'public/index.html',
    nav:    { active: null, variant: 'dark' },
    footer: { tagline: 'Seventeen years of looking.' },
  },
  {
    input:  'build/pages/magazine.html',
    output: 'public/magazine/index.html',
    nav:    { active: 'magazine', variant: 'dark' },
    footer: {},
  },
  {
    input:  'build/pages/gallery.html',
    output: 'public/gallery/index.html',
    nav:    { active: 'gallery', variant: 'dark' },
    footer: {},
  },
  {
    input:  'build/pages/society.html',
    output: 'public/society/index.html',
    nav:    { active: 'society', variant: 'dark' },
    footer: {},
  },
  {
    input:  'build/pages/about.html',
    output: 'public/about/index.html',
    nav:    { active: 'about', variant: 'light' },
    footer: {},
  },
  {
    input:  'build/pages/contact.html',
    output: 'public/contact/index.html',
    nav:    { active: 'contact', variant: 'dark' },
    footer: {},
  },
  {
    input:  'build/pages/support.html',
    output: 'public/support/index.html',
    nav:    { active: 'support', variant: 'dark' },
    footer: {},
  },
];
