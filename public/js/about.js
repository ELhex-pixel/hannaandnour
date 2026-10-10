/**
 * About page ("Notre histoire"): applies the admin-managed story content
 * (settings `story`, served through /api/config) to the hero and the
 * "Made with Intention" sections. Falls back to the static/i18n markup.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;

  function setText(id, text, key) {
    var el = document.getElementById(id);
    if (!el || text == null || text === '') return;
    el.textContent = key ? HN.tr(key) : text;
    if (key) el.setAttribute('data-i18n', key); else el.removeAttribute('data-i18n');
  }

  function setImage(id, src) {
    var el = document.getElementById(id);
    if (!el || !src) return;
    el.src = src;
  }

  function applyStory(story) {
    if (!story || typeof story !== 'object') return;
    var hero = story.hero || {};
    var heroKeys = hero.text_keys || {};
    setText('storyHeroSubtitle', hero.subtitle, heroKeys.subtitle);
    setText('storyHeroTitle', hero.title, heroKeys.title);
    setText('storyHeroP1', hero.p1, heroKeys.p1);
    setText('storyHeroP2', hero.p2, heroKeys.p2);
    setImage('storyHeroImage', hero.image);

    var craft = story.craft || {};
    var craftKeys = craft.text_keys || {};
    setText('storyCraftSubtitle', craft.subtitle, craftKeys.subtitle);
    setText('storyCraftTitle', craft.title, craftKeys.title);
    setText('storyCraftP1', craft.p1, craftKeys.p1);
    setText('storyCraftP2', craft.p2, craftKeys.p2);
    setImage('storyCraftImage', craft.image);
  }

  function init() {
    HN.requireConfig()
      .then(function (cfg) {
        if (cfg) applyStory(cfg.story || null);
      })
      .catch(function () { /* static content remains */ });
  }

  init();
})();
