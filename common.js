var P;
var Common = (function() {
  var DEFAULT_OPTIONS = P.player.Player.DEFAULT_OPTIONS;
  var TRUE = ['true', 'yes', 'on', '1'];
  var FALSE = ['false', 'no', 'off', '0'];
  function URLsearchParams(name,isD) {
    return new URL(window.location.href).searchParams.get(name);
  }
  var playerOptions = {};
  playerOptions.projectHost = (URLsearchParams('legacy',true) == null) ? 'https://projects.scratch.mit.edu/$id' : 'https://projects.scratch.mit.edu/internalapi/project/$id/get/';
  playerOptions.turbo = (URLsearchParams('turbo',true) != null);
  P.config.useWebGL = (URLsearchParams('webgl',true) != null);
  if (URLsearchParams('fps',true)) playerOptions.fps = URLsearchParams('fps',true);
  if (URLsearchParams('user',true)) playerOptions.username = URLsearchParams('user',true);
  playerOptions.autoplayPolicy = (URLsearchParams('autoplay',true) != null) ? 'always' : 'never';
  playerOptions.controls = (URLsearchParams('controls',true) != null);
  P.VectorCostume.DISABLE_RASTERIZE = (URLsearchParams('svgr',true) != null);
  if (URLsearchParams('soundbank',true)) playerOptions.soundbank = URLsearchParams('soundbank',true);
  return {
    playerOptions: playerOptions,
  };
}());