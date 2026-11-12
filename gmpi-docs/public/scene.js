'use strict';
/* Pointer-parallax for the home table-tennis illustration. Progressive enhancement only:
   the scene and its rally animation are pure CSS/SVG and work without this file. */
(function () {
  var scene = document.getElementById('ppScene');
  var tilt = document.getElementById('ppTilt');
  if (!scene || !tilt) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var raf = 0, rx = 0, ry = 0;
  function apply() {
    raf = 0;
    tilt.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    tilt.style.setProperty('--ry', ry.toFixed(2) + 'deg');
  }
  function queue() { if (!raf) raf = requestAnimationFrame(apply); }
  scene.addEventListener('pointermove', function (e) {
    var r = scene.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var nx = (e.clientX - r.left) / r.width - 0.5;
    var ny = (e.clientY - r.top) / r.height - 0.5;
    ry = nx * 10;
    rx = -ny * 8;
    queue();
  });
  scene.addEventListener('pointerleave', function () { rx = 0; ry = 0; queue(); });
})();