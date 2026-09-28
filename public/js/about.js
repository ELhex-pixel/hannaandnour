/**
 * About page ("Notre histoire"): applies the admin-managed story content
 * (settings `story`, served through /api/config) to the hero and the
 * "Made with Intention" sections. Falls back to the static/i18n markup.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;

  function setText(id, text) {
    var el = document.getElementById(id);
    if (!el || text == null || text === '') return;
    el.textContent = text;
    el.removeAttribute('data-i18n');
  }

  function setImage(id, src) {
    var el = document.getElementById(id);
    if (!el || !src) return;
    el.src = src;
  }

  function applyStory(story) {
    if (!story || typeof story !== 'object') return;
    var hero = story.hero || {};
    setText('storyHeroSubtitle', hero.subtitle);
    setText('storyHeroTitle', hero.title);
    setText('storyHeroP1', hero.p1);
    setText('storyHeroP2', hero.p2);
    setImage('storyHeroImage', hero.image);

    var craft = story.craft || {};
    setText('storyCraftSubtitle', craft.subtitle);
    setText('storyCraftTitle', craft.title);
    setText('storyCraftP1', craft.p1);
    setText('storyCraftP2', craft.p2);
    setImage('storyCraftImage', craft.image);
  }

  function init() {
    HN.loadConfig()
      .then(function (cfg) {
        if (cfg) applyStory(cfg.story || null);
      })
      .catch(function () { /* static content remains */ });
  }

  init();
})();