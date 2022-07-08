/*

Pinkiephorus - an html5 player for Scratch projects
 
Version: 1.15 February 4, 2022

pinkiephorus was created by Anim-Tred.
Its CPS-style compilation was inspired by Rhys's sb2.js.
The JSZip library is used to read .sb2 and .sb3 files.
The canvg library, created by Gabe Lerner, to render SVGs in <canvas> elements.
The scratch-sb1-converter library is used to support Scratch 1 projects.
The cloud variable server is hosted by fosshost.org

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

if (!('Promise' in window)) {

  throw new Error('Browser does not support Promise');

}

var P = (function(){

  "use strict";

  var config = {

    debug: false,
    
    useWebGL: false,

    scale: window.devicePixelRatio || 1,

    PROJECT_API: 'https://projects.scratch.mit.edu/$id',

  }

  var inherits = function(cla, sup) {

    cla.prototype = Object.create(sup.prototype);
    cla.prototype.constructor = cla;

  };

  var Shader = {};

  Shader.penVert = `

    precision mediump float;
    attribute vec4 vertexData;
    attribute vec2 lineData;
    attribute vec4 colorData;
    varying vec4 fragColor;
    
    void main(){

      vec2 lineDir = normalize(vertexData.zw - vertexData.xy);
      mat2 rot;
      rot[0] = vec2(cos(lineData.x), sin(lineData.x));
      rot[1] = vec2(-sin(lineData.x), cos(lineData.x));
      lineDir *= rot * lineData.y;
      vec2 p = (vertexData.xy + lineDir);
      p.x /= 240.0;
      p.y /= 180.0;
      gl_Position = vec4(p, 0.0, 1.0);
      fragColor = colorData;

    }

  `;

  Shader.penFrag = `

    precision mediump float;
    varying vec4 fragColor;
    void main(){

      gl_FragColor = vec4(fragColor.xyz / 255.0, fragColor.w);

    }

  `;

  Shader.imgVert = `

    attribute vec2 a_position;
    uniform mat3 u_matrix;
    varying vec2 v_texcoord;

    void main() {
      gl_Position = vec4((u_matrix * vec3(a_position, 1)).xy, 0, 1);
      v_texcoord = a_position;

    }
  `;

  Shader.imgFrag = `
    precision mediump float;
    varying vec2 v_texcoord;
    uniform sampler2D u_texture;
    #ifdef ENABLE_BRIGHTNESS
      uniform float u_brightness;
    #endif
    #ifdef ENABLE_COLOR
      uniform float u_color;
    #endif
    #ifdef ENABLE_GHOST
      uniform float u_opacity;
    #endif
    #ifdef ENABLE_MOSAIC
      uniform float u_mosaic;
    #endif
    #ifdef ENABLE_WHIRL
      uniform float u_whirl;
    #endif
    #ifdef ENABLE_FISHEYE
      uniform float u_fisheye;
    #endif
    #ifdef ENABLE_PIXELATE
      uniform float u_pixelate;
      uniform vec2 u_size;
    #endif
    #ifdef ENABLE_COLOR_TEST
      uniform vec3 u_colorTest;
    #endif
    const float minimumAlpha = 1.0 / 250.0;
    const vec2 vecCenter = vec2(0.5, 0.5);

    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = c.g < c.b ? vec4(c.bg, K.wz) : vec4(c.gb, K.xy);
      vec4 q = c.r < p.x ? vec4(p.xyw, c.r) : vec4(c.r, p.yzx);
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
      
      vec2 texcoord = v_texcoord;
      #ifdef ENABLE_MOSAIC
      if (u_mosaic != 1.0) {
        texcoord = fract(u_mosaic * v_texcoord);
      }
      #endif
      #ifdef ENABLE_PIXELATE
      if (u_pixelate != 0.0) {
        vec2 texelSize = u_size / u_pixelate;
        texcoord = (floor(texcoord * texelSize) + vecCenter) / texelSize;
      }
      #endif
      #ifdef ENABLE_WHIRL
      {
        const float radius = 0.5;
        vec2 offset = texcoord - vecCenter;
        float offsetMagnitude = length(offset);
        float whirlFactor = max(1.0 - (offsetMagnitude / radius), 0.0);
        float whirlActual = u_whirl * whirlFactor * whirlFactor;
        float sinWhirl = sin(whirlActual);
        float cosWhirl = cos(whirlActual);
        mat2 rotationMatrix = mat2(
          cosWhirl, -sinWhirl,
          sinWhirl, cosWhirl
        );
        texcoord = rotationMatrix * offset + vecCenter;
      }
      #endif
      #ifdef ENABLE_FISHEYE
      {
        vec2 vec = (texcoord - vecCenter) / vecCenter;
        float vecLength = length(vec);
        float r = pow(min(vecLength, 1.0), u_fisheye) * max(1.0, vecLength);
        vec2 unit = vec / vecLength;
        texcoord = vecCenter + r * unit * vecCenter;
      }
      #endif
      vec4 color = texture2D(u_texture, texcoord);
      #ifndef DISABLE_MINIMUM_ALPHA
      if (color.a < minimumAlpha) {
        discard;
      }
      #endif
      #ifdef ENABLE_GHOST
      color.a *= u_opacity;
      #endif
      #ifdef ENABLE_COLOR
      if (u_color != 0.0) {
        vec3 hsv = rgb2hsv(color.rgb);
        // hsv.x = hue
        // hsv.y = saturation
        // hsv.z = value
        // scratch forces all colors to have some minimal amount saturation so there is a visual change
        const float minValue = 0.11 / 2.0;
        const float minSaturation = 0.09;
        if (hsv.z < minValue) hsv = vec3(0.0, 1.0, minValue);
        else if (hsv.y < minSaturation) hsv = vec3(0.0, minSaturation, hsv.z);
        hsv.x = mod(hsv.x + u_color, 1.0);
        if (hsv.x < 0.0) hsv.x += 1.0;
        color = vec4(hsv2rgb(hsv), color.a);
      }
      #endif
      #ifdef ENABLE_BRIGHTNESS
      color.rgb = clamp(color.rgb + vec3(u_brightness), 0.0, 1.0);
      #endif
      #ifdef ENABLE_COLOR_TEST
      if (color.rgb != u_colorTest) {
        color = vec4(0.0, 0.0, 0.0, 0.0);
      }
      #endif
      gl_FragColor = color;

    }
  `;

  var m3 = {}

  m3.multiply = function(out, other) {

    const a0 = out[0];
    const a1 = out[1];
    const a2 = out[2];
    const a3 = out[3];
    const a4 = out[4];
    const a5 = out[5];
    const a6 = out[6];
    const a7 = out[7];
    const a8 = out[8];

    const b0 = other[0];
    const b1 = other[1];
    const b2 = other[2];
    const b3 = other[3];
    const b4 = other[4];
    const b5 = other[5];
    const b6 = other[6];
    const b7 = other[7];
    const b8 = other[8];

    out[0] = b0 * a0 + b1 * a3 + b2 * a6;
    out[1] = b0 * a1 + b1 * a4 + b2 * a7;
    out[2] = b0 * a2 + b1 * a5 + b2 * a8;
    out[3] = b3 * a0 + b4 * a3 + b5 * a6;
    out[4] = b3 * a1 + b4 * a4 + b5 * a7;
    out[5] = b3 * a2 + b4 * a5 + b5 * a8;
    out[6] = b6 * a0 + b7 * a3 + b8 * a6;
    out[7] = b6 * a1 + b7 * a4 + b8 * a7;
    out[8] = b6 * a2 + b7 * a5 + b8 * a8;

  }

  m3.translation = function(x, y) {

    return [

      1, 0, 0,
      0, 1, 0,
      x, y, 1,

    ];

  }

  m3.rotation = function(degrees) {

    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    return [

      cos, -sin, 0,
      sin, cos, 0,
      0, 0, 1,

    ];

  }

  m3.scaling = (x, y) => {

    return [

      x, 0, 0,
      0, y, 0,
      0, 0, 1,

    ];

  }
  
  m3.projection = (width, height) => {

    return [

      2 / width, 0, 0,
      0, -2 / height, 0,
      -1, 1, 1,

    ];

  }

  var initShaderProgram = function (gl, vsSource, fsSource, definitions) {

    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource, definitions);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource, definitions)
    const shaderProgram = gl.createProgram();

    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    return shaderProgram;

  }

  var loadShader = function (gl, type, source, definitions) {

    if (definitions) {

      for (const def of definitions) {

        source = '#define ' + def + '\n' + source;

      }

    }

    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    return shader;

  }

  var initImgBuffers = function (gl) {

    var position = gl.createBuffer();

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1]), gl.STATIC_DRAW);
    
    return {

      position: position,

    }

  }

  var glMakeTexture = function (gl, canvas) {

    var tex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    return tex;
  }

  function setCostumeTexture(gl) {

    gl.costumeTextures = new Map();

  }

  var getCSSFilter = function(filters) {

    let filter = '';

    if (filters.brightness) {

      filter += 'brightness(' + (100 + filters.brightness) + '%) ';

    }

    if (filters.color) {

      if (filters.color === Infinity) {

        filter += 'grayscale(100%) ';

      } else {

        filter += 'hue-rotate(' + (filters.color / 200 * 360) + 'deg) ';

      }

    }

    return filter;

  }

  var workingCanvas = document.createElement('canvas');

  var workingContext = workingCanvas.getContext('2d');

  const COLOR_MASK = 0b111110001111100011110000;

  var SB3_SOUNDBANK_FILES = {

    '1_24': 'sb3/instruments/1-piano/24.mp3',
    '1_36': 'sb3/instruments/1-piano/36.mp3',
    '1_48': 'sb3/instruments/1-piano/48.mp3',
    '1_60': 'sb3/instruments/1-piano/60.mp3',
    '1_72': 'sb3/instruments/1-piano/72.mp3',
    '1_84': 'sb3/instruments/1-piano/84.mp3',
    '1_96': 'sb3/instruments/1-piano/96.mp3',
    '1_108': 'sb3/instruments/1-piano/108.mp3',
    '2_60': 'sb3/instruments/2-electric-piano/60.mp3',
    '3_60': 'sb3/instruments/3-organ/60.mp3',
    '4_60': 'sb3/instruments/4-guitar/60.mp3',
    '5_60': 'sb3/instruments/5-electric-guitar/60.mp3',
    '6_36': 'sb3/instruments/6-bass/36.mp3',
    '6_48': 'sb3/instruments/6-bass/48.mp3',
    '7_60': 'sb3/instruments/7-pizzicato/60.mp3',
    '8_36': 'sb3/instruments/8-cello/36.mp3',
    '8_48': 'sb3/instruments/8-cello/48.mp3',
    '8_60': 'sb3/instruments/8-cello/60.mp3',
    '9_36': 'sb3/instruments/9-trombone/36.mp3',
    '9_48': 'sb3/instruments/9-trombone/48.mp3',
    '9_60': 'sb3/instruments/9-trombone/60.mp3',
    '10_48': 'sb3/instruments/10-clarinet/48.mp3',
    '10_60': 'sb3/instruments/10-clarinet/60.mp3',
    '11_36': 'sb3/instruments/11-saxophone/36.mp3',
    '11_60': 'sb3/instruments/11-saxophone/60.mp3',
    '11_84': 'sb3/instruments/11-saxophone/84.mp3',
    '12_60': 'sb3/instruments/12-flute/60.mp3',
    '12_72': 'sb3/instruments/12-flute/72.mp3',
    '13_60': 'sb3/instruments/13-wooden-flute/60.mp3',
    '13_72': 'sb3/instruments/13-wooden-flute/72.mp3',
    '14_36': 'sb3/instruments/14-bassoon/36.mp3',
    '14_48': 'sb3/instruments/14-bassoon/48.mp3',
    '14_60': 'sb3/instruments/14-bassoon/60.mp3',
    '15_48': 'sb3/instruments/15-choir/48.mp3',
    '15_60': 'sb3/instruments/15-choir/60.mp3',
    '15_72': 'sb3/instruments/15-choir/72.mp3',
    '16_60': 'sb3/instruments/16-vibraphone/60.mp3',
    '16_72': 'sb3/instruments/16-vibraphone/72.mp3',
    '17_60': 'sb3/instruments/17-music-box/60.mp3',
    '18_60': 'sb3/instruments/18-steel-drum/60.mp3',
    '19_60': 'sb3/instruments/19-marimba/60.mp3',
    '20_60': 'sb3/instruments/20-synth-lead/60.mp3',
    '21_60': 'sb3/instruments/21-synth-pad/60.mp3',

    '1': 'sb3/drums/1-snare.mp3',
    '2': 'sb3/drums/2-bass-drum.mp3',
    '3': 'sb3/drums/3-side-stick.mp3',
    '4': 'sb3/drums/4-crash-cymbal.mp3',
    '5': 'sb3/drums/5-open-hi-hat.mp3',
    '6': 'sb3/drums/6-closed-hi-hat.mp3',
    '7': 'sb3/drums/7-tambourine.mp3',
    '8': 'sb3/drums/8-hand-clap.mp3',
    '9': 'sb3/drums/9-claves.mp3',
    '10': 'sb3/drums/10-wood-block.mp3',
    '11': 'sb3/drums/11-cowbell.mp3',
    '12': 'sb3/drums/12-triangle.mp3',
    '13': 'sb3/drums/13-bongo.mp3',
    '14': 'sb3/drums/14-conga.mp3',
    '15': 'sb3/drums/15-cabasa.mp3',
    '16': 'sb3/drums/16-guiro.mp3',
    '17': 'sb3/drums/17-vibraslap.mp3',
    '18': 'sb3/drums/18-cuica.mp3',

  };

  var SB2_SOUNDBANK_FILES = {

    'AcousticGuitar_F3': 'sb2/instruments/AcousticGuitar_F3_22k.wav',
    'AcousticPiano_As3': 'sb2/instruments/AcousticPiano(5)_A%233_22k.wav',
    'AcousticPiano_C4': 'sb2/instruments/AcousticPiano(5)_C4_22k.wav',
    'AcousticPiano_G4': 'sb2/instruments/AcousticPiano(5)_G4_22k.wav',
    'AcousticPiano_F5': 'sb2/instruments/AcousticPiano(5)_F5_22k.wav',
    'AcousticPiano_C6': 'sb2/instruments/AcousticPiano(5)_C6_22k.wav',
    'AcousticPiano_Ds6': 'sb2/instruments/AcousticPiano(5)_D%236_22k.wav',
    'AcousticPiano_D7': 'sb2/instruments/AcousticPiano(5)_D7_22k.wav',
    'AltoSax_A3': 'sb2/instruments/AltoSax_A3_22K.wav',
    'AltoSax_C6': 'sb2/instruments/AltoSax(3)_C6_22k.wav',
    'Bassoon_C3': 'sb2/instruments/Bassoon_C3_22k.wav',
    'BassTrombone_A2_2': 'sb2/instruments/BassTrombone_A2(2)_22k.wav',
    'BassTrombone_A2_3': 'sb2/instruments/BassTrombone_A2(3)_22k.wav',
    'Cello_C2': 'sb2/instruments/Cello(3b)_C2_22k.wav',
    'Cello_As2': 'sb2/instruments/Cello(3)_A%232_22k.wav',
    'Choir_F3': 'sb2/instruments/Choir(4)_F3_22k.wav',
    'Choir_F4': 'sb2/instruments/Choir(4)_F4_22k.wav',
    'Choir_F5': 'sb2/instruments/Choir(4)_F5_22k.wav',
    'Clarinet_C4': 'sb2/instruments/Clarinet_C4_22k.wav',
    'ElectricBass_G1': 'sb2/instruments/ElectricBass(2)_G1_22k.wav',
    'ElectricGuitar_F3': 'sb2/instruments/ElectricGuitar(2)_F3(1)_22k.wav',
    'ElectricPiano_C2': 'sb2/instruments/ElectricPiano_C2_22k.wav',
    'ElectricPiano_C4': 'sb2/instruments/ElectricPiano_C4_22k.wav',
    'EnglishHorn_D4': 'sb2/instruments/EnglishHorn(1)_D4_22k.wav',
    'EnglishHorn_F3': 'sb2/instruments/EnglishHorn(1)_F3_22k.wav',
    'Flute_B5_1': 'sb2/instruments/Flute(3)_B5(1)_22k.wav',
    'Flute_B5_2': 'sb2/instruments/Flute(3)_B5(2)_22k.wav',
    'Marimba_C4': 'sb2/instruments/Marimba_C4_22k.wav',
    'MusicBox_C4': 'sb2/instruments/MusicBox_C4_22k.wav',
    'Organ_G2': 'sb2/instruments/Organ(2)_G2_22k.wav',
    'Pizz_A3': 'sb2/instruments/Pizz(2)_A3_22k.wav',
    'Pizz_E4': 'sb2/instruments/Pizz(2)_E4_22k.wav',
    'Pizz_G2': 'sb2/instruments/Pizz(2)_G2_22k.wav',
    'SteelDrum_D5': 'sb2/instruments/SteelDrum_D5_22k.wav',
    'SynthLead_C4': 'sb2/instruments/SynthLead(6)_C4_22k.wav',
    'SynthLead_C6': 'sb2/instruments/SynthLead(6)_C6_22k.wav',
    'SynthPad_A3': 'sb2/instruments/SynthPad(2)_A3_22k.wav',
    'SynthPad_C6': 'sb2/instruments/SynthPad(2)_C6_22k.wav',
    'TenorSax_C3': 'sb2/instruments/TenorSax(1)_C3_22k.wav',
    'Trombone_B3': 'sb2/instruments/Trombone_B3_22k.wav',
    'Trumpet_E5': 'sb2/instruments/Trumpet_E5_22k.wav',
    'Vibraphone_C3': 'sb2/instruments/Vibraphone_C3_22k.wav',
    'Violin_D4': 'sb2/instruments/Violin(2)_D4_22K.wav',
    'Violin_A4': 'sb2/instruments/Violin(3)_A4_22k.wav',
    'Violin_E5': 'sb2/instruments/Violin(3b)_E5_22k.wav',
    'WoodenFlute_C5': 'sb2/instruments/WoodenFlute_C5_22k.wav',
    'BassDrum': 'sb2/drums/BassDrum(1b)_22k.wav',
    'Bongo': 'sb2/drums/Bongo_22k.wav',
    'Cabasa': 'sb2/drums/Cabasa(1)_22k.wav',
    'Clap': 'sb2/drums/Clap(1)_22k.wav',
    'Claves': 'sb2/drums/Claves(1)_22k.wav',
    'Conga': 'sb2/drums/Conga(1)_22k.wav',
    'Cowbell': 'sb2/drums/Cowbell(3)_22k.wav',
    'Crash': 'sb2/drums/Crash(2)_22k.wav',
    'Cuica': 'sb2/drums/Cuica(2)_22k.wav',
    'GuiroLong': 'sb2/drums/GuiroLong(1)_22k.wav',
    'GuiroShort': 'sb2/drums/GuiroShort(1)_22k.wav',
    'HiHatClosed': 'sb2/drums/HiHatClosed(1)_22k.wav',
    'HiHatOpen': 'sb2/drums/HiHatOpen(2)_22k.wav',
    'HiHatPedal': 'sb2/drums/HiHatPedal(1)_22k.wav',
    'Maracas': 'sb2/drums/Maracas(1)_22k.wav',
    'SideStick': 'sb2/drums/SideStick(1)_22k.wav',
    'SnareDrum': 'sb2/drums/SnareDrum(1)_22k.wav',
    'Tambourine': 'sb2/drums/Tambourine(3)_22k.wav',
    'Tom': 'sb2/drums/Tom(1)_22k.wav',
    'Triangle': 'sb2/drums/Triangle(1)_22k.wav',
    'Vibraslap': 'sb2/drums/Vibraslap(1)_22k.wav',
    'WoodBlock': 'sb2/drums/WoodBlock(1)_22k.wav'

  };

  var IO = {};

  IO.config = {
    localPath: '',
  };

  IO.PROJECT_URL = 'https://projects.scratch.mit.edu/$id';

  IO.ASSET_URL = 'https://cdn.assets.scratch.mit.edu/internalapi/asset/$id/get';

  IO.reader = function (blob,type) {

    return new Promise((resolve, reject) => {

      var fileReader = new FileReader();

      fileReader.onload = function () {

        if (type == 'base64') {

          var i = 0;

          while (!(fileReader.result.charAt(i) == ',')) {

            i++;

          }

          i++;

          resolve(fileReader.result.slice(i, fileReader.result.length));

        } else {

          resolve(fileReader.result);

        }

      }

      if (type == 'text') {

        fileReader.readAsText(blob);

      } else if (type == 'arraybuffer') {

        fileReader.readAsArrayBuffer(blob);

      } else if (type == 'dataurl') {

        fileReader.readAsDataURL(blob);

      } else if (type == 'base64') {

        fileReader.readAsDataURL(blob);

      }

    });

  }

  IO.loadImage = function (url) {

    return new Promise(function(resolve,reject) {

      var a = new Image();

      a.onload = function() {

        resolve(a);

      }

      a.onerror = function() {

        a.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAABBJREFUeNpi+P//PwNAgAEACPwC/tuiTRYAAAAASUVORK5CYII=';
      }

      a.src = url;

    });

  }

  IO.loadDotImage = function () {

    return new Promise(function(resolve,reject) {

      var a = new Image();

      a.onload = function() {

        resolve(a);

      }

      a.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAABBJREFUeNpi+P//PwNAgAEACPwC/tuiTRYAAAAASUVORK5CYII=';
    
    });

  }
  
  IO.md5NullS = function (md5,isAudio) {

    if (isAudio == false) {

      return md5 ? md5 : '8e768a5a5a01891b05c01c9ca15eb6aa.svg';

    } else if (isAudio == true) {

      return md5 ? md5 : '83c36d806dc92327b9e7049a565c6bff.wav';

    }

  }

  IO.parseJSONish = function (json) {
    class JSONParser {

      constructor(source) {

        this.source = source;
        this.index = 0;

      }

      parse() {

        return this.parseValue();

      }

      lineInfo() {

        let line = 0;
        let column = 0;

        for (var i = 0; i < this.index; i++) {

          if (this.source[i] === '\n') {

            line++;
            column = 0;

          } else {

            column++;

          }

        }

        return { line: line + 1, column: column + 1 };

      }

      error(message) {

        const { line, column } = this.lineInfo();
        throw new SyntaxError(`JSONParser: ${message} (Line ${line} Column ${column})`);

      }

      char() {

        return this.charAt(this.index);

      }

      charAt(index) {

        if (index >= this.source.length) {

          this.error('Unexpected end of input');

        }

        return this.source[index];

      }

      next() {

        this.index++;

      }

      expect(char) {

        if (this.char() !== char) {

          this.error(`Expected '${char}' but found '${this.char()}'`);

        }

        this.next();

      }

      peek(length = 1, offset = 1) {
        if (length === 1)
          return this.charAt(this.index + offset);

        let result = '';

        for (var i = 0; i < length; i++) {

          result += this.charAt(this.index + offset + i);

        }

        return result;

      }
      skipWhitespace() {
        while (/\s/.test(this.char())) {
          this.next();
        }
      }
      parseValue() {

        this.skipWhitespace();
        const char = this.char();

        switch (char) {

          case '"': return this.parseString();

          case '{': return this.parseObject();

          case '[': return this.parseList();

          case '0':

          case '1':

          case '2':

          case '3':

          case '4':

          case '5':

          case '6':

          case '7':

          case '8':

          case '9':

          case '-':

            return this.parseNumber();

          default: return this.parseWord();

        }

      }

      parseWord() {

        if (this.peek(4, 0) === 'null') {

          for (var i = 0; i < 4; i++)

            this.next();

          return null;

        }

        if (this.peek(4, 0) === 'true') {

          for (var i = 0; i < 4; i++)

            this.next();

          return true;

        }

        if (this.peek(5, 0) === 'false') {

          for (var i = 0; i < 5; i++)

            this.next();

          return false;

        }

        if (this.peek(8, 0) === 'Infinity') {

          for (var i = 0; i < 8; i++)

            this.next();

          return Infinity;

        }

        if (this.peek(9, 0) === '-Infinity') {

          for (var i = 0; i < 9; i++)

            this.next();

          return -Infinity;

        }

        if (this.peek(3, 0) === 'NaN') {

          for (var i = 0; i < 3; i++)
            this.next();

          return NaN;

        }

        this.error(`Unknown word (starts with ${this.char()})`);

      }
      parseNumber() {
        let number = '';
        while (true) {

          number += this.char();

          if (/[\d\.e+-]/i.test(this.peek())) {

            this.next();

          } else {

            break;

          }
        }

        this.next();
        const value = +number;

        if (Number.isNaN(value)) {

        this.error('Not a number: ' + number);

        }

        return value;

      }
      parseString() {
        this.expect('"');
        let result = '';

        if (this.char() === '"') {

          this.next();
          return '';

        }

        while (true) {

          const char = this.char();

          if (char === '\\') {

            this.next();

            switch (this.char()) {
              case '"':

                result += '"';
                break;

              case '/':

                result += '/';
                break;

              case '\\':

                result += '\\';
                break;

              case 'b':

                result += '\b';
                break;

              case 'f':

                result += '\f';
                break;

              case 'n':

                result += '\n';
                break;

              case 'r':

                result += '\r';
                break;

              case 't':

                result += '\t';
                break;

              case 'u': {

                let hexString = '';

                for (var i = 0; i < 4; i++) {

                  this.next();

                  const char = this.char();

                  if (!/[0-9a-f]/i.test(char)) {

                      this.error('Invalid hex code: ' + char);

                  }

                  hexString += char;

                }

                const hexNumber = Number.parseInt(hexString, 16);
                const letter = String.fromCharCode(hexNumber);

                result += letter;

                break;

              }

              default: this.error('Invalid escape code: \\' + this.char());

            }

          } else {

            result += char;

          }

          if (this.peek() === '"') {

            break;

          }

          this.next();

        }

        this.next();
        this.expect('"');

        return result;

      }
      parseList() {

        this.expect('[');
        this.skipWhitespace();

        if (this.char() === ']') {

          this.next();
          return [];

        }

        const result = [];

        while (true) {

          this.skipWhitespace();
          const value = this.parseValue();
          result.push(value);
          this.skipWhitespace();

          if (this.char() === ']') {

            break;

          }

          this.expect(',');
        }

        this.expect(']');
        return result;

      }

      parseObject() {

        this.expect('{');
        this.skipWhitespace();

        if (this.char() === '}') {

          this.next();
          return {};

        }

        const result = Object.create(null);

        while (true) {

          this.skipWhitespace();
          const key = this.parseString();
          this.skipWhitespace();
          this.expect(':');
          const value = this.parseValue();
          result[key] = value;
          this.skipWhitespace();
          
          if (this.char() === '}') {

            break;

          }

          this.expect(',');

        }
        this.expect('}');
        return result;

      }

    }

    if (!/^\s*{/.test(json)) {

      throw new Error('The input does not seem to be a JSON object');

    }

    try {

      return JSON.parse(json);

    } catch (firstError) {

      try {

        const parser = new JSONParser(json);
        return parser.parse();

      } catch (secondError) {

        throw firstError;

      }

    }

  }

  IO.RequestLoad = function (url,typ) {

    return new Promise(function(resolve,reject) {

      fetch(url).then(res => {

        if (res.status == 200 || res.status == 404) {

          res.blob().then(file => {

            var a = new FileReader();

            a.onload = function() {

              resolve(a.result);

            }

            if (typ == 'arraybuffer') {

              a.readAsArrayBuffer(file);

            } else if (typ == 'text'){

              a.readAsText(file);

            } else if (typ == 'dataurl'){

              a.readAsDataURL(file);

            } else if (typ == 'blob'){

              resolve(file);

            }

          });

        } else {

          reject(new Error('Unexpected status code: ' + res.status));

        }

      }).catch(err => {

        reject(err);

      })

    });

  }

  IO.loadSoundbankSB2 = function () {

    return new Promise(async function(resolve,reject) {

      for (const name in SB2_SOUNDBANK_FILES) {

        if (!IO.wavBuffers[name]) {

          var s = await IO.RequestLoad(window.sb2Soundtrack['soundbank/' + SB2_SOUNDBANK_FILES[name]],'arraybuffer');
          var r = await IO.decodeAudio(s);

          IO.wavBuffers[name] = r;

        } 

      }

      resolve();

    });

  }
  
  IO.loadSoundbankSB3 = function () {

    return new Promise(async function(resolve,reject) {

      for (const name in SB3_SOUNDBANK_FILES) {

        if (!IO.wavBuffers[name]) {

          var s = await IO.RequestLoad(window.sb3Soundtrack['soundbank/' + SB3_SOUNDBANK_FILES[name]],'arraybuffer');
          var r = await IO.decodeAudio(s);

          IO.wavBuffers[name] = r;

        } 

      }

      resolve();

    });

  }

  IO.soundbankSb2 = {};

  IO.soundbankSb3 = {};

  IO.soundbankSb2.INSTRUMENTS = [
      [
        { top: 38, name: 'AcousticPiano_As3', baseRatio: 0.5316313272700484, loop: true, loopStart: 0.465578231292517, loopEnd: 0.7733786848072562, attackEnd: 0, holdEnd: 0.1, decayEnd: 22.1 },
        { top: 44, name: 'AcousticPiano_C4', baseRatio: 0.5905141892259927, loop: true, loopStart: 0.6334693877551021, loopEnd: 0.8605442176870748, attackEnd: 0, holdEnd: 0.1, decayEnd: 20.1 },
        { top: 51, name: 'AcousticPiano_G4', baseRatio: 0.8843582887700535, loop: true, loopStart: 0.5532879818594104, loopEnd: 0.5609977324263039, attackEnd: 0, holdEnd: 0.08, decayEnd: 18.08 },
        { top: 62, name: 'AcousticPiano_C6', baseRatio: 2.3557692307692304, loop: true, loopStart: 0.5914739229024943, loopEnd: 0.6020861678004535, attackEnd: 0, holdEnd: 0.08, decayEnd: 16.08 },
        { top: 70, name: 'AcousticPiano_F5', baseRatio: 1.5776515151515151, loop: true, loopStart: 0.5634920634920635, loopEnd: 0.5879818594104308, attackEnd: 0, holdEnd: 0.04, decayEnd: 14.04 },
        { top: 77, name: 'AcousticPiano_Ds6', baseRatio: 2.800762112139358, loop: true, loopStart: 0.560907029478458, loopEnd: 0.5836281179138322, attackEnd: 0, holdEnd: 0.02, decayEnd: 10.02 },
        { top: 85, name: 'AcousticPiano_Ds6', baseRatio: 2.800762112139358, loop: true, loopStart: 0.560907029478458, loopEnd: 0.5836281179138322, attackEnd: 0, holdEnd: 0, decayEnd: 8 },
        { top: 90, name: 'AcousticPiano_Ds6', baseRatio: 2.800762112139358, loop: true, loopStart: 0.560907029478458, loopEnd: 0.5836281179138322, attackEnd: 0, holdEnd: 0, decayEnd: 6 },
        { top: 96, name: 'AcousticPiano_D7', baseRatio: 5.275119617224881, loop: true, loopStart: 0.3380498866213152, loopEnd: 0.34494331065759637, attackEnd: 0, holdEnd: 0, decayEnd: 3 },
        { top: 128, name: 'AcousticPiano_D7', baseRatio: 5.275119617224881, loop: true, loopStart: 0.3380498866213152, loopEnd: 0.34494331065759637, attackEnd: 0, holdEnd: 0, decayEnd: 2 }
      ], [
        { top: 48, name: 'ElectricPiano_C2', baseRatio: 0.14870515241435123, loop: true, loopStart: 0.6956009070294784, loopEnd: 0.7873015873015873, attackEnd: 0, holdEnd: 0.08, decayEnd: 10.08 },
        { top: 74, name: 'ElectricPiano_C4', baseRatio: 0.5945685670261941, loop: true, loopStart: 0.5181859410430839, loopEnd: 0.5449433106575964, attackEnd: 0, holdEnd: 0.04, decayEnd: 8.04 },
        { top: 128, name: 'ElectricPiano_C4', baseRatio: 0.5945685670261941, loop: true, loopStart: 0.5181859410430839, loopEnd: 0.5449433106575964, attackEnd: 0, holdEnd: 0, decayEnd: 6 }
      ], [
        { top: 128, name: 'Organ_G2', baseRatio: 0.22283731584620914, loop: true, loopStart: 0.05922902494331066, loopEnd: 0.1510204081632653, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [{ top: 40, name: 'AcousticGuitar_F3', baseRatio: 0.3977272727272727, loop: true, loopStart: 1.6628117913832199, loopEnd: 1.6685260770975057, attackEnd: 0, holdEnd: 0, decayEnd: 15 },
        { top: 56, name: 'AcousticGuitar_F3', baseRatio: 0.3977272727272727, loop: true, loopStart: 1.6628117913832199, loopEnd: 1.6685260770975057, attackEnd: 0, holdEnd: 0, decayEnd: 13.5 },
        { top: 60, name: 'AcousticGuitar_F3', baseRatio: 0.3977272727272727, loop: true, loopStart: 1.6628117913832199, loopEnd: 1.6685260770975057, attackEnd: 0, holdEnd: 0, decayEnd: 12 },
        { top: 67, name: 'AcousticGuitar_F3', baseRatio: 0.3977272727272727, loop: true, loopStart: 1.6628117913832199, loopEnd: 1.6685260770975057, attackEnd: 0, holdEnd: 0, decayEnd: 8.5 },
        { top: 72, name: 'AcousticGuitar_F3', baseRatio: 0.3977272727272727, loop: true, loopStart: 1.6628117913832199, loopEnd: 1.6685260770975057, attackEnd: 0, holdEnd: 0, decayEnd: 7 },
        { top: 83, name: 'AcousticGuitar_F3', baseRatio: 0.3977272727272727, loop: true, loopStart: 1.6628117913832199, loopEnd: 1.6685260770975057, attackEnd: 0, holdEnd: 0, decayEnd: 5.5 },
        { top: 128, name: 'AcousticGuitar_F3', baseRatio: 0.3977272727272727, loop: true, loopStart: 1.6628117913832199, loopEnd: 1.6685260770975057, attackEnd: 0, holdEnd: 0, decayEnd: 4.5 }
      ], [
        { top: 40, name: 'ElectricGuitar_F3', baseRatio: 0.39615522817103843, loop: true, loopStart: 1.5733333333333333, loopEnd: 1.5848072562358, attackEnd: 0, holdEnd: 0, decayEnd: 15 },
        { top: 56, name: 'ElectricGuitar_F3', baseRatio: 0.39615522817103843, loop: true, loopStart: 1.5733333333333333, loopEnd: 1.5848072562358277, attackEnd: 0, holdEnd: 0, decayEnd: 13.5 },
        { top: 60, name: 'ElectricGuitar_F3', baseRatio: 0.39615522817103843, loop: true, loopStart: 1.5733333333333333, loopEnd: 1.5848072562358277, attackEnd: 0, holdEnd: 0, decayEnd: 12 },
        { top: 67, name: 'ElectricGuitar_F3', baseRatio: 0.39615522817103843, loop: true, loopStart: 1.5733333333333333, loopEnd: 1.5848072562358277, attackEnd: 0, holdEnd: 0, decayEnd: 8.5 },
        { top: 72, name: 'ElectricGuitar_F3', baseRatio: 0.39615522817103843, loop: true, loopStart: 1.5733333333333333, loopEnd: 1.5848072562358277, attackEnd: 0, holdEnd: 0, decayEnd: 7 },
        { top: 83, name: 'ElectricGuitar_F3', baseRatio: 0.39615522817103843, loop: true, loopStart: 1.5733333333333333, loopEnd: 1.5848072562358277, attackEnd: 0, holdEnd: 0, decayEnd: 5.5 },
        { top: 128, name: 'ElectricGuitar_F3', baseRatio: 0.39615522817103843, loop: true, loopStart: 1.5733333333333333, loopEnd: 1.5848072562358277, attackEnd: 0, holdEnd: 0, decayEnd: 4.5 }
      ], [
        { top: 34, name: 'ElectricBass_G1', baseRatio: 0.11111671034065712, loop: true, loopStart: 1.9007709750566892, loopEnd: 1.9212244897959183, attackEnd: 0, holdEnd: 0, decayEnd: 17 },
        { top: 48, name: 'ElectricBass_G1', baseRatio: 0.11111671034065712, loop: true, loopStart: 1.9007709750566892, loopEnd: 1.9212244897959183, attackEnd: 0, holdEnd: 0, decayEnd: 14 },
        { top: 64, name: 'ElectricBass_G1', baseRatio: 0.11111671034065712, loop: true, loopStart: 1.9007709750566892, loopEnd: 1.9212244897959183, attackEnd: 0, holdEnd: 0, decayEnd: 12 },
        { top: 128, name: 'ElectricBass_G1', baseRatio: 0.11111671034065712, loop: true, loopStart: 1.9007709750566892, loopEnd: 1.9212244897959183, attackEnd: 0, holdEnd: 0, decayEnd: 10 }
      ], [
        { top: 38, name: 'Pizz_G2', baseRatio: 0.21979665071770335, loop: true, loopStart: 0.3879365079365079, loopEnd: 0.3982766439909297, attackEnd: 0, holdEnd: 0, decayEnd: 5 },
        { top: 45, name: 'Pizz_G2', baseRatio: 0.21979665071770335, loop: true, loopStart: 0.3879365079365079, loopEnd: 0.3982766439909297, attackEnd: 0, holdEnd: 0.012, decayEnd: 4.012 },
        { top: 56, name: 'Pizz_A3', baseRatio: 0.503654636820466, loop: true, loopStart: 0.5197278911564626, loopEnd: 0.5287528344671202, attackEnd: 0, holdEnd: 0, decayEnd: 4 },
        { top: 64, name: 'Pizz_A3', baseRatio: 0.503654636820466, loop: true, loopStart: 0.5197278911564626, loopEnd: 0.5287528344671202, attackEnd: 0, holdEnd: 0, decayEnd: 3.2 },
        { top: 72, name: 'Pizz_E4', baseRatio: 0.7479647218453188, loop: true, loopStart: 0.7947845804988662, loopEnd: 0.7978231292517007, attackEnd: 0, holdEnd: 0, decayEnd: 2.8 },
        { top: 80, name: 'Pizz_E4', baseRatio: 0.7479647218453188, loop: true, loopStart: 0.7947845804988662, loopEnd: 0.7978231292517007, attackEnd: 0, holdEnd: 0, decayEnd: 2.2 },
        { top: 128, name: 'Pizz_E4', baseRatio: 0.7479647218453188, loop: true, loopStart: 0.7947845804988662, loopEnd: 0.7978231292517007, attackEnd: 0, holdEnd: 0, decayEnd: 1.5 }
      ], [
        { top: 41, name: 'Cello_C2', baseRatio: 0.14870515241435123, loop: true, loopStart: 0.3876643990929705, loopEnd: 0.40294784580498866, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 52, name: 'Cello_As2', baseRatio: 0.263755980861244, loop: true, loopStart: 0.3385487528344671, loopEnd: 0.35578231292517004, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 62, name: 'Violin_D4', baseRatio: 0.6664047388781432, loop: true, loopStart: 0.48108843537414964, loopEnd: 0.5151927437641723, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 75, name: 'Violin_A4', baseRatio: 0.987460815047022, loop: true, loopStart: 0.14108843537414967, loopEnd: 0.15029478458049886, attackEnd: 0.07, holdEnd: 0.07, decayEnd: 0.07 },
        { top: 128, name: 'Violin_E5', baseRatio: 1.4885238523852387, loop: true, loopStart: 0.10807256235827664, loopEnd: 0.1126530612244898, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 30, name: 'BassTrombone_A2_3', baseRatio: 0.24981872564125807, loop: true, loopStart: 0.061541950113378686, loopEnd: 0.10702947845804989, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 40, name: 'BassTrombone_A2_2', baseRatio: 0.24981872564125807, loop: true, loopStart: 0.08585034013605441, loopEnd: 0.13133786848072562, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 55, name: 'Trombone_B3', baseRatio: 0.5608240680183126, loop: true, loopStart: 0.12, loopEnd: 0.17673469387755103, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 88, name: 'Trombone_B3', baseRatio: 0.5608240680183126, loop: true, loopStart: 0.12, loopEnd: 0.17673469387755103, attackEnd: 0.05, holdEnd: 0.05, decayEnd: 0.05 },
        { top: 128, name: 'Trumpet_E5', baseRatio: 1.4959294436906376, loop: true, loopStart: 0.1307936507936508, loopEnd: 0.14294784580498865, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 128, name: 'Clarinet_C4', baseRatio: 0.5940193965517241, loop: true, loopStart: 0.6594104308390023, loopEnd: 0.7014965986394558, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 40, name: 'TenorSax_C3', baseRatio: 0.2971698113207547, loop: true, loopStart: 0.4053968253968254, loopEnd: 0.4895238095238095, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 50, name: 'TenorSax_C3', baseRatio: 0.2971698113207547, loop: true, loopStart: 0.4053968253968254, loopEnd: 0.4895238095238095, attackEnd: 0.02, holdEnd: 0.02, decayEnd: 0.02 },
        { top: 59, name: 'TenorSax_C3', baseRatio: 0.2971698113207547, loop: true, loopStart: 0.4053968253968254, loopEnd: 0.4895238095238095, attackEnd: 0.04, holdEnd: 0.04, decayEnd: 0.04 },
        { top: 67, name: 'AltoSax_A3', baseRatio: 0.49814747876378096, loop: true, loopStart: 0.3875736961451247, loopEnd: 0.4103854875283447, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 75, name: 'AltoSax_A3', baseRatio: 0.49814747876378096, loop: true, loopStart: 0.3875736961451247, loopEnd: 0.4103854875283447, attackEnd: 0.02, holdEnd: 0.02, decayEnd: 0.02 },
        { top: 80, name: 'AltoSax_A3', baseRatio: 0.49814747876378096, loop: true, loopStart: 0.3875736961451247, loopEnd: 0.4103854875283447, attackEnd: 0.02, holdEnd: 0.02, decayEnd: 0.02 },
        { top: 128, name: 'AltoSax_C6', baseRatio: 2.3782742681047764, loop: true, loopStart: 0.05705215419501134, loopEnd: 0.0838095238095238, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 61, name: 'Flute_B5_2', baseRatio: 2.255113636363636, loop: true, loopStart: 0.08430839002267573, loopEnd: 0.10244897959183673, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 128, name: 'Flute_B5_1', baseRatio: 2.255113636363636, loop: true, loopStart: 0.10965986394557824, loopEnd: 0.12780045351473923, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 128, name: 'WoodenFlute_C5', baseRatio: 1.1892952324548416, loop: true, loopStart: 0.5181859410430839, loopEnd: 0.7131065759637188, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 57, name: 'Bassoon_C3', baseRatio: 0.29700969827586204, loop: true, loopStart: 0.11011337868480725, loopEnd: 0.19428571428571428, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 67, name: 'Bassoon_C3', baseRatio: 0.29700969827586204, loop: true, loopStart: 0.11011337868480725, loopEnd: 0.19428571428571428, attackEnd: 0.04, holdEnd: 0.04, decayEnd: 0.04 },
        { top: 76, name: 'Bassoon_C3', baseRatio: 0.29700969827586204, loop: true, loopStart: 0.11011337868480725, loopEnd: 0.19428571428571428, attackEnd: 0.08, holdEnd: 0.08, decayEnd: 0.08 },
        { top: 84, name: 'EnglishHorn_F3', baseRatio: 0.39601293103448276, loop: true, loopStart: 0.341859410430839, loopEnd: 0.4049886621315193, attackEnd: 0.04, holdEnd: 0.04, decayEnd: 0.04 },
        { top: 128, name: 'EnglishHorn_D4', baseRatio: 0.6699684005833739, loop: true, loopStart: 0.22027210884353743, loopEnd: 0.23723356009070296, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 39, name: 'Choir_F3', baseRatio: 0.3968814788643197, loop: true, loopStart: 0.6352380952380953, loopEnd: 1.8721541950113378, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 50, name: 'Choir_F3', baseRatio: 0.3968814788643197, loop: true, loopStart: 0.6352380952380953, loopEnd: 1.8721541950113378, attackEnd: 0.04, holdEnd: 0.04, decayEnd: 0.04 },
        { top: 61, name: 'Choir_F3', baseRatio: 0.3968814788643197, loop: true, loopStart: 0.6352380952380953, loopEnd: 1.8721541950113378, attackEnd: 0.06, holdEnd: 0.06, decayEnd: 0.06 },
        { top: 72, name: 'Choir_F4', baseRatio: 0.7928898424161845, loop: true, loopStart: 0.7415419501133786, loopEnd: 2.1059410430839, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 128, name: 'Choir_F5', baseRatio: 1.5879576065654504, loop: true, loopStart: 0.836281179138322, loopEnd: 2.0585487528344673, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 38, name: 'Vibraphone_C3', baseRatio: 0.29829545454545453, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0.1, decayEnd: 8.1 },
        { top: 48, name: 'Vibraphone_C3', baseRatio: 0.29829545454545453, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0.1, decayEnd: 7.6 },
        { top: 59, name: 'Vibraphone_C3', baseRatio: 0.29829545454545453, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0.06, decayEnd: 7.06 },
        { top: 70, name: 'Vibraphone_C3', baseRatio: 0.29829545454545453, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0.04, decayEnd: 6.04 },
        { top: 78, name: 'Vibraphone_C3', baseRatio: 0.29829545454545453, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0.02, decayEnd: 5.02 },
        { top: 86, name: 'Vibraphone_C3', baseRatio: 0.29829545454545453, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0, decayEnd: 4 },
        { top: 128, name: 'Vibraphone_C3', baseRatio: 0.29829545454545453, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0, decayEnd: 3 }
      ], [
        { top: 128, name: 'MusicBox_C4', baseRatio: 0.5937634640241276, loop: true, loopStart: 0.6475283446712018, loopEnd: 0.6666666666666666, attackEnd: 0, holdEnd: 0, decayEnd: 2 }
      ], [
        { top: 128, name: 'SteelDrum_D5', baseRatio: 1.3660402567543959, loop: false, loopStart: -0.000045351473922902495, loopEnd: -0.000045351473922902495, attackEnd: 0, holdEnd: 0, decayEnd: 2 }
      ], [
        { top: 128, name: 'Marimba_C4', baseRatio: 0.5946035575013605, loop: false, loopStart: -0.000045351473922902495, loopEnd: -0.000045351473922902495, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 80, name: 'SynthLead_C4', baseRatio: 0.5942328422565577, loop: true, loopStart: 0.006122448979591836, loopEnd: 0.06349206349206349, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
        { top: 128, name: 'SynthLead_C6', baseRatio: 2.3760775862068964, loop: true, loopStart: 0.005623582766439909, loopEnd: 0.01614512471655329, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ], [
        { top: 38, name: 'SynthPad_A3', baseRatio: 0.4999105065330231, loop: true, loopStart: 0.1910204081632653, loopEnd: 3.9917006802721087, attackEnd: 0.05, holdEnd: 0.05, decayEnd: 0.05 },
        { top: 50, name: 'SynthPad_A3', baseRatio: 0.4999105065330231, loop: true, loopStart: 0.1910204081632653, loopEnd: 3.9917006802721087, attackEnd: 0.08, holdEnd: 0.08, decayEnd: 0.08 },
        { top: 62, name: 'SynthPad_A3', baseRatio: 0.4999105065330231, loop: true, loopStart: 0.1910204081632653, loopEnd: 3.9917006802721087, attackEnd: 0.11, holdEnd: 0.11, decayEnd: 0.11 },
        { top: 74, name: 'SynthPad_A3', baseRatio: 0.4999105065330231, loop: true, loopStart: 0.1910204081632653, loopEnd: 3.9917006802721087, attackEnd: 0.15, holdEnd: 0.15, decayEnd: 0.15 },
        { top: 86, name: 'SynthPad_A3', baseRatio: 0.4999105065330231, loop: true, loopStart: 0.1910204081632653, loopEnd: 3.9917006802721087, attackEnd: 0.2, holdEnd: 0.2, decayEnd: 0.2 },
        { top: 128, name: 'SynthPad_C6', baseRatio: 2.3820424708835755, loop: true, loopStart: 0.11678004535147392, loopEnd: 0.41732426303854875, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
      ]
    ];

  IO.soundbankSb2.DRUMS = [
      { name: 'SnareDrum', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Tom', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'SideStick', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Crash', baseRatio: 0.8908987181403393, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'HiHatOpen', baseRatio: 0.9438743126816935, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'HiHatClosed', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Tambourine', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Clap', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Claves', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'WoodBlock', baseRatio: 0.7491535384383408, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Cowbell', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Triangle', baseRatio: 0.8514452780229479, loop: true, loopStart: 0.7638548752834468, loopEnd: 0.7825396825396825, attackEnd: 0, holdEnd: 0, decayEnd: 2 },
      { name: 'Bongo', baseRatio: 0.5297315471796477, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Conga', baseRatio: 0.7954545454545454, loop: true, loopStart: 0.1926077097505669, loopEnd: 0.20403628117913833, attackEnd: 0, holdEnd: 0, decayEnd: 2 },
      { name: 'Cabasa', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'GuiroLong', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Vibraslap', baseRatio: 0.8408964152537145, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { name: 'Cuica', baseRatio: 0.7937005259840998, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
    ];

  IO.soundbankSb3.INSTRUMENTS = [
    [
      { top: 24, name: '1_24', baseRatio: 1, loop: true, loopStart: 0.465578231292517, loopEnd: 0.7733786848072562, attackEnd: 0, holdEnd: 0.1, decayEnd: 22.1 },
      { top: 36, name: '1_36', baseRatio: 1, loop: true, loopStart: 0.6334693877551021, loopEnd: 0.8605442176870748, attackEnd: 0, holdEnd: 0.1, decayEnd: 20.1 },
      { top: 48, name: '1_48', baseRatio: 1, loop: true, loopStart: 0.5532879818594104, loopEnd: 0.5609977324263039, attackEnd: 0, holdEnd: 0.08, decayEnd: 18.08 },
      { top: 60, name: '1_60', baseRatio: 1, loop: true, loopStart: 0.5914739229024943, loopEnd: 0.6020861678004535, attackEnd: 0, holdEnd: 0.08, decayEnd: 16.08 },
      { top: 72, name: '1_72', baseRatio: 1, loop: true, loopStart: 0.5634920634920635, loopEnd: 0.5879818594104308, attackEnd: 0, holdEnd: 0.04, decayEnd: 14.04 },
      { top: 84, name: '1_84', baseRatio: 1, loop: true, loopStart: 0.560907029478458, loopEnd: 0.5836281179138322, attackEnd: 0, holdEnd: 0.02, decayEnd: 10.02 },
      { top: 96, name: '1_96', baseRatio: 1, loop: true, loopStart: 0.560907029478458, loopEnd: 0.5836281179138322, attackEnd: 0, holdEnd: 0, decayEnd: 8 },
      { top: 108, name: '1_108', baseRatio: 1, loop: true, loopStart: 0.560907029478458, loopEnd: 0.5836281179138322, attackEnd: 0, holdEnd: 0, decayEnd: 6 },
    ], [
      { top: 60, name: '2_60', baseRatio: 1, loop: true, loopStart: 0.6956009070294784, loopEnd: 0.7873015873015873, attackEnd: 0, holdEnd: 0.08, decayEnd: 10.08 },
    ], [
      { top: 60, name: '3_60', baseRatio: 1, loop: true, loopStart: 0.05922902494331066, loopEnd: 0.1510204081632653, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
    ], [
      { top: 60, name: '4_60', baseRatio: 1, loop: true, loopStart: 1.6628117913832199, loopEnd: 1.6685260770975057, attackEnd: 0, holdEnd: 0, decayEnd: 15 },
    ], [
      { top: 60, name: '5_60', baseRatio: 1, loop: true, loopStart: 1.5733333333333333, loopEnd: 1.5848072562358, attackEnd: 0, holdEnd: 0, decayEnd: 15 },
    ], [
      { top: 36, name: '6_36', baseRatio: 1, loop: true, loopStart: 1.9007709750566892, loopEnd: 1.9212244897959183, attackEnd: 0, holdEnd: 0, decayEnd: 17 },
      { top: 48, name: '6_48', baseRatio: 1, loop: true, loopStart: 1.9007709750566892, loopEnd: 1.9212244897959183, attackEnd: 0, holdEnd: 0, decayEnd: 14 },
    ], [
      { top: 60, name: '7_60', baseRatio: 1, loop: true, loopStart: 0.3879365079365079, loopEnd: 0.3982766439909297, attackEnd: 0, holdEnd: 0, decayEnd: 5 },
    ], [
      { top: 36, name: '8_36', baseRatio: 1, loop: true, loopStart: 0.3876643990929705, loopEnd: 0.40294784580498866, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 48, name: '8_48', baseRatio: 1, loop: true, loopStart: 0.3385487528344671, loopEnd: 0.35578231292517004, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 60, name: '8_60', baseRatio: 1, loop: true, loopStart: 0.48108843537414964, loopEnd: 0.5151927437641723, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    ], [
      { top: 36, name: '9_36', baseRatio: 1, loop: true, loopStart: 0.061541950113378686, loopEnd: 0.10702947845804989, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 48, name: '9_48', baseRatio: 1, loop: true, loopStart: 0.08585034013605441, loopEnd: 0.13133786848072562, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 60, name: '9_60', baseRatio: 1, loop: true, loopStart: 0.12, loopEnd: 0.17673469387755103, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    ], [
      { top: 48, name: '10_48', baseRatio: 1, loop: true, loopStart: 0.6594104308390023, loopEnd: 0.7014965986394558, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 60, name: '10_60', baseRatio: 1, loop: true, loopStart: 0.6594104308390023, loopEnd: 0.7014965986394558, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    ], [
      { top: 36, name: '11_36', baseRatio: 1, loop: true, loopStart: 0.4053968253968254, loopEnd: 0.4895238095238095, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 60, name: '11_60', baseRatio: 1, loop: true, loopStart: 0.4053968253968254, loopEnd: 0.4895238095238095, attackEnd: 0.02, holdEnd: 0.02, decayEnd: 0.02 },
      { top: 84, name: '11_84', baseRatio: 1, loop: true, loopStart: 0.4053968253968254, loopEnd: 0.4895238095238095, attackEnd: 0.04, holdEnd: 0.04, decayEnd: 0.04 },
    ], [
      { top: 60, name: '12_60', baseRatio: 1, loop: true, loopStart: 0.08430839002267573, loopEnd: 0.10244897959183673, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 72, name: '12_72', baseRatio: 1, loop: true, loopStart: 0.10965986394557824, loopEnd: 0.12780045351473923, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
    ], [
      { top: 60, name: '13_60', baseRatio: 1, loop: true, loopStart: 0.5181859410430839, loopEnd: 0.7131065759637188, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 72, name: '13_72', baseRatio: 1, loop: true, loopStart: 0.11011337868480725, loopEnd: 0.19428571428571428, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    ], [
      { top: 36, name: '14_36', baseRatio: 1, loop: true, loopStart: 0.11011337868480725, loopEnd: 0.19428571428571428, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 48, name: '14_48', baseRatio: 1, loop: true, loopStart: 0.11011337868480725, loopEnd: 0.19428571428571428, attackEnd: 0.04, holdEnd: 0.04, decayEnd: 0.04 },
      { top: 60, name: '14_60', baseRatio: 1, loop: true, loopStart: 0.11011337868480725, loopEnd: 0.19428571428571428, attackEnd: 0.08, holdEnd: 0.08, decayEnd: 0.08 },
    ], [
      { top: 48, name: '15_48', baseRatio: 1, loop: true, loopStart: 0.6352380952380953, loopEnd: 1.8721541950113378, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
      { top: 60, name: '15_60', baseRatio: 1, loop: true, loopStart: 0.6352380952380953, loopEnd: 1.8721541950113378, attackEnd: 0.04, holdEnd: 0.04, decayEnd: 0.04 },
      { top: 72, name: '15_72', baseRatio: 1, loop: true, loopStart: 0.6352380952380953, loopEnd: 1.8721541950113378, attackEnd: 0.06, holdEnd: 0.06, decayEnd: 0.06 },
    ], [
      { top: 60, name: '16_60', baseRatio: 1, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0.1, decayEnd: 8.1 },
      { top: 72, name: '16_72', baseRatio: 1, loop: true, loopStart: 0.2812698412698413, loopEnd: 0.28888888888888886, attackEnd: 0, holdEnd: 0.1, decayEnd: 7.6 },
    ], [
      { top: 60, name: '17_60', baseRatio: 1, loop: true, loopStart: 0.6475283446712018, loopEnd: 0.6666666666666666, attackEnd: 0, holdEnd: 0, decayEnd: 2 }
    ], [
      { top: 60, name: '18_60', baseRatio: 1, loop: false, loopStart: -0.000045351473922902495, loopEnd: -0.000045351473922902495, attackEnd: 0, holdEnd: 0, decayEnd: 2 }
    ], [
      { top: 60, name: '19_60', baseRatio: 1, loop: false, loopStart: -0.000045351473922902495, loopEnd: -0.000045351473922902495, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
    ], [
      { top: 60, name: '20_60', baseRatio: 1, loop: true, loopStart: 0.006122448979591836, loopEnd: 0.06349206349206349, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    ], [
      { top: 60, name: '21_60', baseRatio: 1, loop: true, loopStart: 0.1910204081632653, loopEnd: 3.9917006802721087, attackEnd: 0.05, holdEnd: 0.05, decayEnd: 0.05 },
    ]
  ];

  IO.soundbankSb3.DRUMS = [
    { name: '1', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '2', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '3', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '4', baseRatio: 0.8908987181403393, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '5', baseRatio: 0.9438743126816935, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '6', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '7', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '8', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '9', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '10', baseRatio: 0.7491535384383408, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '11', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '12', baseRatio: 0.8514452780229479, loop: true, loopStart: 0.7638548752834468, loopEnd: 0.7825396825396825, attackEnd: 0, holdEnd: 0, decayEnd: 2 },
    { name: '13', baseRatio: 0.5297315471796477, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '14', baseRatio: 0.7954545454545454, loop: true, loopStart: 0.1926077097505669, loopEnd: 0.20403628117913833, attackEnd: 0, holdEnd: 0, decayEnd: 2 },
    { name: '15', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '16', baseRatio: 0.5946035575013605, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '17', baseRatio: 0.8408964152537145, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 },
    { name: '18', baseRatio: 0.7937005259840998, loop: false, loopStart: null, loopEnd: null, attackEnd: 0, holdEnd: 0, decayEnd: 0 }
  ];

  IO.wavBuffers = {};

  IO.ADPCM_STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
  
  IO.ADPCM_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

  IO.decodeAudio = function (ab) {

    if (!P.audioContext) {

      return Promise.reject(new Error('No audio context'));

    }

    return new Promise((resolve, reject) => {

      IO.decodeADPCMAudio(ab, function (err1, buffer) {

        if (buffer) {

          resolve(buffer);
          return;

        }

        P.audioContext.decodeAudioData(ab, function (buffer) {

          resolve(buffer);

        }, function () {

          
          P.audioContext.decodeAudioData(new Uint8Array([82, 73, 70, 70, 200, 9, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 128, 187, 0, 0, 0, 119, 1, 0, 2, 0, 16, 0, 100, 97, 116, 97, 164, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer, function (buffer) {
            resolve(buffer);

          }, function () {});

        });

      });

    });

  }
  
  IO.decodeADPCMAudio = function (ab,cb) {

    var dv = new DataView(ab);

    if (dv.getUint32(0) !== 0x52494646 || dv.getUint32(8) !== 0x57415645) {

      return cb(new Error('Unrecognized audio format'));

    }

    var blocks = {};

    var i = 12, l = dv.byteLength - 8;

    while (i < l) {
      blocks[String.fromCharCode(dv.getUint8(i), dv.getUint8(i + 1), dv.getUint8(i + 2), dv.getUint8(i + 3))] = i;
      i += 8 + dv.getUint32(i + 4, true);
    }

    var format = dv.getUint16(20, true);
    var sampleRate = dv.getUint32(24, true);

    if (format === 17) {

      var samplesPerBlock = dv.getUint16(38, true);
      var blockSize = ((samplesPerBlock - 1) / 2) + 4;
      var frameCount = dv.getUint32(blocks.fact + 8, true);
      var buffer = P.audioContext.createBuffer(1, frameCount, sampleRate);
      var channel = buffer.getChannelData(0);

      var sample, index = 0;
      var step, code, delta;
      var lastByte = -1;

      var offset = blocks.data + 8;
      i = offset;
      var j = 0;

      while (true) {
        if ((((i - offset) % blockSize) == 0) && (lastByte < 0)) {
          if (i >= dv.byteLength)
            break;
          sample = dv.getInt16(i, true);
          i += 2;
          index = dv.getUint8(i);
          i += 1;
          i++;
          if (index > 88)
            index = 88;
          channel[j++] = sample / 32767;
        } else {
          if (lastByte < 0) {
            if (i >= dv.byteLength)
              break;
            lastByte = dv.getUint8(i);
            i += 1;
            code = lastByte & 0xf;
          } else {
            code = (lastByte >> 4) & 0xf;
            lastByte = -1;
          }
          step = IO.ADPCM_STEPS[index];
          delta = 0;
          if (code & 4)
            delta += step;
          if (code & 2)
            delta += step >> 1;
          if (code & 1)
            delta += step >> 2;
          delta += step >> 3;
          index += IO.ADPCM_INDEX[code];
          if (index > 88)
            index = 88;
          if (index < 0)
            index = 0;
          sample += (code & 8) ? -delta : delta;
          if (sample > 32767)
            sample = 32767;
          if (sample < -32768)
            sample = -32768;
          channel[j++] = sample / 32768;
        }
      }
      return cb(null, buffer);
    }

    cb(new Error('Unrecognized WAV format ' + format));

  }

  IO.Throttler = function () {

    this.maxConcurrentTasks = 900;
    this.concurrentTasks = 0;
    this.queue = [];

  };

  IO.Throttler.prototype.startNextTask = function () {

    if (this.queue.length === 0)

      return;

    if (this.concurrentTasks >= this.maxConcurrentTasks)

      return;

    const fn = this.queue.shift();
    this.concurrentTasks++;
    fn();

  }

  IO.Throttler.prototype.run = function (fn) {

    return new Promise((resolve, reject) => {

      const run = () => {

        fn().then((r) => {

          this.concurrentTasks--;
          this.startNextTask();
          resolve(r);

        }).catch((e) => {

          this.concurrentTasks--;
          this.startNextTask();
          reject(e);

        });

      };

      if (this.concurrentTasks < this.maxConcurrentTasks) {

        this.concurrentTasks++;

        run();

      } else {

        this.queue.push(run);

      }

    });

  }

  IO.requestThrottler = new IO.Throttler();

  IO.AbstractTask = function () {};

  IO.AbstractTask.prototype.setLoader = function (loader) {

    this.loader = loader;

  }

  IO.AbstractTask.prototype.updateLoaderProgress = function () {

    if (this.loader) {

      this.loader.updateProgress();

    }

  }

  IO.Retry = function () {

    IO.AbstractTask.call(this)
    this.aborted = false;
    this.retries = 0;

  }

  inherits(IO.Retry,IO.AbstractTask);

  IO.Retry.prototype.try = async function (handle) {

    const MAX_ATTEMPTS = 4;
    let lastErr;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {

      this.retries = i;

      try {

        return await handle();

      } catch (err) {

        if (this.aborted) {
          throw err;
        }

        lastErr = err;
        const retryIn = 2 ** i * 500 * Math.random() + 50;
        console.warn(`Attempt #${i + 1} to ${this.getRetryWarningDescription()} failed, trying again in ${retryIn}ms`, err);
        await P.utils.sleep(retryIn);

      }
    }
    throw lastErr;
  }

  IO.Retry.prototype.getRetryWarningDescription = function (handle) {

    return 'complete task';

  }

  IO.Request = function (url) {

    IO.Retry.call(this)
    this.url = url;
    this.shouldIgnoreErrors = false;
    this.complete = false;
    this.status = 0;
    this.xhr = null;

  }

  inherits(IO.Request,IO.Retry);

  IO.Request.prototype.isComplete = function () {

    return this.complete;

  }

  IO.Request.prototype.ignoreErrors = function () {

    this.shouldIgnoreErrors = true;
    return this;

  }

  IO.Request.prototype._load = function () {

    return new Promise((resolve, reject) => {

      const xhr = new XMLHttpRequest();
      xhr.open('GET', this.url);
      this.xhr = xhr;
      xhr.responseType = this.responseType;

      xhr.onload = () => {

        this.status = xhr.status;

        if (IO.Request.acceptableResponseCodes.indexOf(xhr.status) !== -1 || this.shouldIgnoreErrors) {

          resolve(xhr.response);

        } else {

          reject(new Error(`HTTP Error ${xhr.status} while downloading ${this.url} (r=${this.retries} s=${xhr.readyState}/${xhr.status}/${xhr.statusText})`));
        
        }

      }

      xhr.onloadend = (e) => {
        this.xhr = null;
        this.complete = true;
        this.updateLoaderProgress();
      };

      xhr.onerror = (err) => {

        reject(new Error(`Error while downloading ${this.url} (error) (r=${this.retries} s=${xhr.readyState}/${xhr.status}/${xhr.statusText})`));
      
      };

      xhr.onabort = (err) => {

        this.aborted = true;
        reject(new Error(`Error while downloading ${this.url} (abort)`));
      };

      xhr.send();

    })

  }

  IO.Request.prototype.load = function (type) {

    this.responseType = type;
    return IO.requestThrottler.run(() => this.try(() => this._load()));

  }

  IO.Request.prototype.getRetryWarningDescription = function (handle) {

    return `download ${this.url}`;

  }

  IO.Request.acceptableResponseCodes = [0, 200];
  
  IO.Img = function (src) {

    IO.Retry.call(this);

    this.src = src;
    this.shouldIgnoreErrors = false;
    this.complete = false;

  }

  inherits(IO.Img,IO.Retry)

  IO.Img.prototype.isComplete = function () {

    return this.complete;

  }


  IO.Img.prototype.ignoreErrors = function () {
    this.shouldIgnoreErrors = true;
    return this;
  }

  IO.Img.prototype._load = function () {

    return new Promise((resolve, reject) => {

      const image = new Image();

      image.onload = () => {

        this.complete = true;
        this.updateLoaderProgress();
        image.onload = null;
        image.onerror = null;

        resolve(image);

      };

      image.onerror = () => {

        if (!this.shouldIgnoreErrors) {
          image.onload = null;
          image.onerror = null;
          reject(new Error(`Failed to load image: ${image.src} (r=${this.retries})`));
        } else {
          image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAABBJREFUeNpi+P//PwNAgAEACPwC/tuiTRYAAAAASUVORK5CYII=';
        }

      };

      image.crossOrigin = 'anonymous';

      setTimeout(() => {
          image.src = this.src;
      });

    });
  }

  IO.Img.prototype.load = function () {
    return IO.requestThrottler.run(() => this.try(() => this._load()));
  }

  IO.Img.prototype.getRetryWarningDescription = function () {
    return `download image ${this.src}`;
  }

  IO.Manual = function () {
    IO.AbstractTask.call(this);
    this.complete = false;
    this.aborted = false;
  }

  inherits(IO.Manual, IO.AbstractTask);

  IO.Manual.prototype.markComplete = function () {
    this.complete = true;
    this.updateLoaderProgress();
  }

  IO.Manual.prototype.isComplete = function () {
    return this.complete;
  }

  IO.Manual.prototype.abort = function () {
    this.aborted = true;
  }

  IO.Loader = function () {
    this._tasks = [];
    this.aborted = false;
    this.error = false;
  }

  IO.Loader.prototype.calculateProgress = function () {
    if (this.aborted) {
      return 1;
    }
    const totalTasks = this._tasks.length;
    if (totalTasks === 0) {
      return 0;
    }
    let finishedTasks = 0;
    for (const task of this._tasks) {
      if (task.isComplete()) {
        finishedTasks++;
      }
    }
    return finishedTasks / totalTasks;
  }

  IO.Loader.prototype.updateProgress = function () {
    if (this.error) {
      return;
    }
    const progress = this.calculateProgress();
    this.onprogress(progress);
  }

  IO.Loader.prototype.resetTasks = function () {
    this._tasks = [];
    this.updateProgress();
  }

  IO.Loader.prototype.addTask = function (task) {
    this._tasks.push(task);
    task.setLoader(this);
    return task;
  }

  IO.Loader.prototype.abort = function () {
    this.aborted = true;
    for (const task of this._tasks) {
      task.abort();
    }
  }

  IO.Loader.prototype.cleanup = function () {
    for (const task of this._tasks) {
      task.setLoader(null);
    }
    this._tasks.length = 0;
  }

  IO.Loader.prototype.onprogress = function () {}

  var utils = {};

  utils.hslToRGB = function (h, s, l) {

    var r, g, b;

    if (s == 0) {
      r = g = b = l;
    } else {
      function hue2rgb(p, q, t) {
        if (t < 0)
          t += 1;
        if (t > 1)
          t -= 1;
        if (t < 1 / 6)
          return p + (q - p) * 6 * t;
        if (t < 1 / 2)
          return q;
        if (t < 2 / 3)
          return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      }
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return [r * 255, g * 255, b * 255];

  }

  utils.rgbToHSL = function (r, g, b) {

    r /= 255;
    g /= 255;
    b /= 255;
    var min = Math.min(r, g, b);
    var max = Math.max(r, g, b);
    if (min === max) {
      return [0, 0, r];
    }
    var c = max - min;
    var l = (min + max) / 2;
    var s = c / (1 - Math.abs(2 * l - 1));
    var h;
    switch (max) {
      case r:
        h = ((g - b) / c + 6) % 6;
        break;
      case g:
        h = (b - r) / c + 2;
        break;
      case b:
        h = (r - g) / c + 4;
        break;
    }
    h *= 60;
    return [h, s, l];

  }

  utils.hsvToHSL = function (h, s, v) {

    var l = v - v * s / 2;
    var s = l === 0 ? 0 : (v - l) / Math.min(2 - 2 * l / v);
    return [h, s, l];

  }

  utils.rgbToHSV = function (r, g, b) {

    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, v = max;
    var d = max - min;
    s = max == 0 ? 0 : d / max;
    if (max == min) {
      h = 0;
    }
    else {
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h /= 6;
    }
    return [h * 360, s, v];

  }

  utils.hslToHSV = function (h, s, l) {

    var v = l + s * Math.min(l, 1 - l);
    var s = v === 0 ? 0 : 2 - 2 * l / v;
    return [h, s, v];

  }

  utils.hsvToRGB = function (h, s, v) {

    var r, g, b;
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);

    switch (i % 6) {
      case 0:
        r = v, g = t, b = p;
        break;
      case 1:
        r = q, g = v, b = p;
        break;
      case 2:
        r = p, g = v, b = t;
        break;
      case 3:
        r = p, g = q, b = v;
        break;
      case 4:
        r = t, g = p, b = v;
        break;
      case 5:
        r = v, g = p, b = q;
        break;
    }

    return [r * 255 | 0, g * 255 | 0, b * 255 | 0];
  }

  utils.clamp = function (number, min, max) {

    return Math.min(max, Math.max(min, number));

  }

  utils.parseColor = function (color) {

    if (typeof color === 'number') {
      return color;
    }
    if (typeof color === 'string') {
      const nValue = +color;
      if (!isNaN(nValue)) {
        return nValue;
      }
      if (color.startsWith('#')) {
        const hex = color.substr(1);
        const parsedHex = parseInt(hex, 16);
        if (hex.length === 6) {
          return parsedHex;
        } else if (hex.length === 3) {
          const r = parsedHex >> 8 & 0xf;
          const g = parsedHex >> 4 & 0xf;
          const b = parsedHex & 0xf;
          return (((r << 4) | r) << 16 |
            ((g << 4) | g) << 8 |
            ((b << 4) | b));
        }
      }
    }
    return 0;

  }

  utils.parseRotationStyle = function (style) {

    switch (style) {
      case 'leftRight':
      case 'left-right':
        return 1;
      case 'none':
      case 'don\'t rotate':
        return 2;
      case 'normal':
      case 'all around':
        return 0;
    }
    console.warn('unknown rotation style', style);
    return 0;

  }

  utils.settled = function (promise) {

    return new Promise((resolve, _reject) => {
      promise
        .then(() => resolve())
        .catch(() => resolve());
    });

  }

  utils.sleep = function (ms) {

    return new Promise((resolve) => setTimeout(resolve, ms));

  }

  var PenColor = function () {

    this.x = 0;
    this.y = 0;
    this.z = 255;
    this.a = 1;
    this.mode = 0;
    this.type = null;
    this.css = 'rgba(0, 0, 255, 1)';

  }

  PenColor.prototype.setRGBA = function(rgba) {

    this.type = 'RGBA';
    this.x = rgba >> 16 & 0xff;
    this.y = rgba >> 8 & 0xff;
    this.z = rgba & 0xff;
    this.a = (rgba >> 24 & 0xff) / 0xff || 1;
    this.css = 'rgba(' + this.x + ', ' + this.y + ', ' + this.z + ', ' + this.a + ')';
    this.mode = 0;

  };

  PenColor.prototype.setShiftedRGBA = function(rgba) {

    this.setRGBA(rgba);
    this.toHSVA();

  };

  PenColor.prototype.toHSLA = function() {

    this.type = 'HSLA';

    switch (this.mode) {

      case 0: {

        this.mode = 1;
        const hsl = utils.rgbToHSL(this.x, this.y, this.z);
        this.x = hsl[0];
        this.y = hsl[1] * 100;
        this.z = hsl[2] * 100;
        break;

      }

      case 2: {

        this.mode = 1;
        const hsl = utils.hsvToHSL(this.x, this.y / 100, this.z / 100);
        this.x = hsl[0];
        this.y = hsl[1] * 100;
        this.z = hsl[2] * 100;
        break;

      }

    }

  };

  PenColor.prototype.toHSVA = function() {

    this.type = 'HSVA';

    switch (this.mode) {

      case 0: {

        this.mode = 2;
        const hsv = utils.rgbToHSV(this.x, this.y, this.z);
        this.x = hsv[0];
        this.y = hsv[1] * 100;
        this.z = hsv[2] * 100;
        break;

      }

      case 1: {

        this.mode = 2;
        const hsv = utils.hslToHSV(this.x, this.y / 100, this.z / 100);
        this.x = hsv[0];
        this.y = hsv[1] * 100;
        this.z = hsv[2] * 100;
        break;

      }

    }

  }; 

  PenColor.prototype.toParts = function() {

    switch (this.mode) {
      case 0: {

        return [this.x, this.y, this.z, this.a];

      }

      case 2: {
        var r = this.x % 360;

        if (r / 360 < 0) {
            r += 360;
        }

        const rgb = utils.hsvToRGB(r / 360, this.y / 100, (this.z > 100 ? 200 - this.z : this.z) / 100);
        return [rgb[0], rgb[1], rgb[2], this.a];

      }
      case 1: {

        var r = this.x % 360;

        if (r / 360 < 0) {
            r += 360;
        }

        const rgb = utils.hslToRGB(r / 360, this.y / 100, (this.z > 100 ? 200 - this.z : this.z) / 100);
        return [rgb[0], rgb[1], rgb[2], this.a];

      }

    }

  };

  PenColor.prototype.toCSS = function() {

    switch (this.mode) {

      case 0:

        return this.css;

      case 1:

        return 'hsla(' + this.x + ',' + this.y + '%,' + (this.z > 100 ? 200 - this.z : this.z) + '%,' + this.a + ')';

      case 2: {

        const rgb = utils.hsvToRGB(this.x / 360, this.y / 100, this.z / 100);
        return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + this.a + ')';

      }

    }

  };

  PenColor.prototype.setParam = function(param,value) {

    this.toHSVA();

    switch (param) {

      case 'color':
        this.x = (value * 360 / 100) % 360;
        if (this.x < 0)
          this.x += 360;
        break;
      case 'saturation':
        this.y = utils.clamp(value, 0, 100);
        break;
      case 'brightness':
        this.z = utils.clamp(value, 0, 100);
        break;
      case 'transparency':
        this.a = 1 - (value / 100);
        if (this.a > 1)
          this.a = 1;
        if (this.a < 0)
          this.a = 0;
        break;

    }

  };

  PenColor.prototype.changeParam = function(param,value) {

    this.toHSVA();

    switch (param) {
      case 'color':
        this.x = (this.x + value * 360 / 100) % 360;
        if (this.x < 0)
          this.x += 360;
        break;
      case 'saturation':
        this.y = P.utils.clamp(this.y + value, 0, 100);
        break;
      case 'brightness':
        this.z = P.utils.clamp(this.z + value, 0, 100);
        break;
      case 'transparency':
        this.a = Math.max(0, Math.min(1, this.a - value / 100));
        break;
    }

  };

  PenColor.prototype.copy = function(other) {

    this.x = other.x;
    this.y = other.y;
    this.z = other.z;
    this.a = other.a;
    this.css = other.css;
    this.mode = other.mode;
    this.type = other.type;

  };

  var Base = function () {

    this.isStage = false;
    this.isSprite = false;
    this.isClone = false;
    this.costumes = [];
    this.currentCostumeIndex = 0;
    this.volume = 1;
    this.instrument = 0;
    this.visible = true;

    this.sounds = [];
    this.soundRefs = {};

    this.scratchX = 0;
    this.scratchY = 0;
    this.direction = 90;
    this.scale = 1;
    
    this.vars = {};
    this.lists = {};
    this.varIds = {};
    this.listIds = {};
    this.watchers = {};
    this.listWatchers = {};
    
    this.procedures = {};
    this.listeners = {
      whenClicked: [],
      whenCloned: [],
      whenGreenFlag: [],
      whenIReceive: {},
      whenKeyPressed: {},
      whenSceneStarts: {},
      edgeActivated: [],
    };
    this.fns = [];

    this.filters = {
      color: 0,
      fisheye: 0,
      whirl: 0,
      pixelate: 0,
      mosaic: 0,
      brightness: 0,
      ghost: 0,
    };
    this.soundFilters = {
      pitch: 0,
    };

    this.node = null;
    this.activeSounds = new Set();
    
    this.stopped = false;
    this.saying = false;
    this.thinking = false;
    this.sayId = 0;
    
    this.penSize = 1;
    this.penColor = new PenColor();
    this.isPenDown = false;

  }

  Base.prototype.addSound = function(sound) {

    this.soundRefs[sound.name] = sound;
    this.sounds.push(sound);

  }

  Base.prototype.ask = function(question) {

    var stage = this.stage;
    if (question) {
      if (this.visible && this.isSprite) {
        this.say(question);
        stage.promptTitle.style.display = 'none';
      }
      else {
        stage.promptTitle.style.display = 'block';
        stage.promptTitle.textContent = question;
      }
    } else {
      stage.promptTitle.style.display = 'none';
    }
    stage.hidePrompt = false;
    stage.prompter.style.display = 'block';
    stage.prompt.value = '';
    stage.prompt.focus();

  };

  Base.prototype.showVariable = function(name, visible) {

    let watcher = this.watchers[name];
    if (!watcher) {
      const newWatcher = this.createVariableWatcher(this, name);
      if (!newWatcher) {
        return;
      }
      newWatcher.init();
      this.watchers[name] = watcher = newWatcher;
      this.stage.allWatchers.push(watcher);
    }
    watcher.setVisible(visible);

  };

  Base.prototype.showList = function(name, visible) {

    let watcher = this.listWatchers[name];

    if (!watcher) {

      const newWatcher = this.createListWatcher(this, name);
      if (!newWatcher) {
        return;
      }
      newWatcher.init();
      this.listWatchers[name] = watcher = newWatcher;
      this.stage.allWatchers.push(watcher);

    }

    watcher.setVisible(visible);

  };

  Base.prototype.say = function(text, thinking = false) {

    text = '' + text;
    if (text.length === 0) {
      this.saying = false;
      if (this.bubbleContainer)
        this.bubbleContainer.style.display = 'none';
      return ++this.sayId;
    }

    this.saying = true;
    this.thinking = thinking;

    if (!this.bubbleContainer) {

      this.bubbleContainer = document.createElement('div');
      this.bubbleContainer.style.maxWidth = (127 / 14) + 'em';
      this.bubbleContainer.style.minWidth = (48 / 14) + 'em';
      this.bubbleContainer.style.padding = (8 / 14) + 'em ' + (10 / 14) + 'em';
      this.bubbleContainer.style.border = (3 / 14) + 'em solid rgb(160, 160, 160)';
      this.bubbleContainer.style.borderRadius = (10 / 14) + 'em';
      this.bubbleContainer.style.background = '#fff';
      this.bubbleContainer.style.position = 'absolute';
      this.bubbleContainer.style.font = 'bold 1.4em sans-serif';
      this.bubbleContainer.style.whiteSpace = 'pre-wrap';
      this.bubbleContainer.style.wordWrap = 'break-word';
      this.bubbleContainer.style.textAlign = 'center';
      this.bubbleContainer.style.cursor = 'default';
      this.bubbleContainer.style.pointerEvents = 'auto';
      this.bubbleContainer.appendChild(this.bubbleText = document.createTextNode(''));
      this.bubbleContainer.appendChild(this.bubblePointer = document.createElement('div'));

      this.bubblePointer.style.position = 'absolute';
      this.bubblePointer.style.height = (21 / 14) + 'em';
      this.bubblePointer.style.width = (44 / 14) + 'em';
      this.bubblePointer.style.background = 'url("' + P.IO.config.localPath + 'icons.svg")';
      this.bubblePointer.style.backgroundSize = (384 / 14) + 'em ' + (64 / 14) + 'em';
      this.bubblePointer.style.backgroundPositionY = (-4 / 14) + 'em';
      this.stage.ui.appendChild(this.bubbleContainer);

    }

    this.bubblePointer.style.backgroundPositionX = (thinking ? -323 : -259) / 14 + 'em';
    this.bubbleContainer.style.display = 'block';
    this.bubbleText.nodeValue = text;
    this.updateBubble();
    return ++this.sayId;

  };

  Base.prototype.stopSoundsExcept = function(originBase) {

    if (this.node) {

      for (const sound of this.activeSounds) {

        if (sound.base !== originBase) {

          if (sound.node) {

            if (!sound.isSpan || !this.stage.soundbankIsSB3) sound.node.disconnect();

          }

          sound.stopped = true;
          this.activeSounds.delete(sound);

        }

      }

    }

  };

  Base.prototype.getSound = function(name) {

    if (typeof name === 'string') {
      var s = this.soundRefs[name];
      if (s)
        return s;
      name = parseInt(name, 10);
    }

    var l = this.sounds.length;
    if (l && typeof name === 'number' && name === name) {
      var i = Math.round(name - 1) % l;
      if (i < 0)
        i += l;
      return this.sounds[i];
    }

  };

  Base.prototype.showNextCostume = function() {

    this.currentCostumeIndex = (this.currentCostumeIndex + 1) % this.costumes.length;

  };

  Base.prototype.stopSounds = function() {

    if (this.node) {

      for (const sound of this.activeSounds) {

        if (!sound.isSpan || !this.stage.soundbankIsSB3) {

          if (sound.node) {

            if (!sound.isClone || sound.sound_playuntildone) {

              sound.stopped = true;
              sound.node.disconnect();

            }

          }

        }

      }

      this.activeSounds.clear();
      this.node.disconnect();
      this.node = null;

    }

  };

  Base.prototype.destroyCostume = function() {

    for (var i = 0; i < this.costumes.length; i++) {
      this.costumes[i].destroy();
    }

  };

  Base.prototype.addWhenKeyPressedHandler = function(key, fn) {

    if (this.listeners.whenKeyPressed[key]) {
      this.listeners.whenKeyPressed[key].push(fn);
    } else {
      this.listeners.whenKeyPressed[key] = [fn];
    }

  };

  Base.prototype.setCostume = function(costume) {

    if (typeof costume !== 'number') {
      costume = '' + costume;
      for (var i = 0; i < this.costumes.length; i++) {
        if (this.costumes[i].name === costume) {
          this.currentCostumeIndex = i;
          if (this.saying && this.isSprite)
            this.updateBubble();
          return;
        }
      }
      if (costume === (this.isSprite ? 'next costume' : 'next backdrop')) {
        this.showNextCostume();
        return;
      }
      if (costume === (this.isSprite ? 'previous costume' : 'previous backdrop')) {
        this.showPreviousCostume();
        return;
      }
      if (!isFinite(costume) || !/\d/.test(costume)) {
        return;
      }
    }
    var i = (Math.floor(costume) - 1 || 0) % this.costumes.length;
    if (costume == Infinity || costume == -Infinity) {
      i = 0;
    }
    if (i < 0)
      i += this.costumes.length;
    this.currentCostumeIndex = i;
    if (this.isSprite && this.saying)
      this.updateBubble();

  };

  Base.prototype.getCostumeName = function() {

    return this.costumes[this.currentCostumeIndex] ? this.costumes[this.currentCostumeIndex].name : '';

  };

  Base.prototype.changeFilter = function(name,value) {

    this.setFilter(name, this.filters[name] + value);

  };

  Base.prototype.resetFilters = function() {

    this.filters = {

      color: 0,

      fisheye: 0,

      whirl: 0,

      pixelate: 0,

      mosaic: 0,

      brightness: 0,

      ghost: 0

    };

    this.soundFilters = {

      pitch: 0

    };

  };

  Base.prototype.setFilter = function(name, value) {

    switch (name) {

      case 'ghost':

        if (value < 0)

          value = 0;

        if (value > 100)

          value = 100;

        break;

      case 'brightness':

        if (value < -100)

          value = -100;

        if (value > 100)

          value = 100;

        break;

      case 'color':

        if (value === Infinity) {

          break;

        }

        value = value % 200;

        if (value < 0)

          value += 200;

        break;

    }

    this.filters[name] = value;

  };

  Base.prototype.setSoundFilter = function(name, value) {

    value = value || 0;

    switch (name.toLowerCase()) {

      case 'pitch':

        this.soundFilters.pitch = value;

        if (!this.stage.removeLimits) {

          if (this.soundFilters.pitch > 360)

            this.soundFilters.pitch = 360;

          if (this.soundFilters.pitch < -360)

            this.soundFilters.pitch = -360;

        }

        break;

    }

  };

  Base.prototype.changeSoundFilter = function(name) {

    switch (name.toLowerCase()) {

      case 'pitch':

        this.soundFilters.pitch += value;

        if (!this.stage.removeLimits) {

          if (this.soundFilters.pitch > 360)

            this.soundFilters.pitch = 360;

          if (this.soundFilters.pitch < -360)

            this.soundFilters.pitch = -360;

        }

        break;

    }

  };

  Base.prototype.resetSoundFilters = function() {

    this.soundFilters = {

      pitch: 0,

    };

  };

  Base.prototype.remove = function() {

    if (this.bubbleContainer) {
      this.stage.ui.removeChild(this.bubbleContainer);
    }

    if (this.node) {

      if (!this.stage.soundbankIsSB3) {

        for (const sound of this.activeSounds) {

          if (!sound.isSpan || !this.stage.soundbankIsSB3) {

            if (sound.node) {

              if (!sound.isClone || sound.sound_playuntildone) {

                sound.stopped = true;
                sound.node.disconnect(); 

              }

            }

          }

        }

        this.activeSounds.clear();

      }

      this.node.connect(this.stage.getAudioNodeStage());

    }

  };

  Base.prototype.getAudioNodeSpan = function() {

    if (this.stage.soundbankIsSB3) {
      const gain = P.audioContext.createGain();
      gain.gain.value = this.volume;
      gain.connect(this.stage.getAudioNodeStage());
      return gain;
    } else return this.getAudioNode();

  };

  Base.prototype.getAudioNode = function() {

    if (this.node) {
      return this.node;
    }

    this.node = P.audioContext.createGain();
    this.node.gain.value = this.volume;
    this.node.connect(this.stage.getAudioNodeStage());

    return this.node;

  };

  Base.prototype.clearPen = function() {

    if (this.stage.useWebGL) {

      this.stage.penCoordsIndex = 0;
      this.stage.penLinesIndex = 0;
      this.stage.penColorsIndex = 0;
      this.stage.penContext.clearColor(0, 0, 0, 0);
      this.stage.penContext.clear(this.stage.penContext.COLOR_BUFFER_BIT);

    } else {

      this.stage.penContext.clearRect(0, 0, 480, 360);

    }

  };

  Base.prototype.updateBubble = function() {

    if (!this.visible || !this.saying) {
      this.bubbleContainer.style.display = 'none';
      return;
    }

    this.bubbleContainer.style.display = 'block';
    const b = this.rotatedBounds();
    const left = 240 + b.right;
    var bottom = 180 + b.top;
    const width = this.bubbleContainer.offsetWidth / this.stage.zoom;
    const height = this.bubbleContainer.offsetHeight / this.stage.zoom;
    this.bubblePointer.style.top = ((height - 6) / 14) + 'em';
    if (left + width + 2 > 480) {
      var d = (240 - b.left) / 14;
      if (d > 25)
        d = 25;
      this.bubbleContainer.style.right = d + 'em';
      this.bubbleContainer.style.left = 'auto';
      this.bubblePointer.style.right = (3 / 14) + 'em';
      this.bubblePointer.style.left = 'auto';
      this.bubblePointer.style.backgroundPositionY = (-36 / 14) + 'em';
    } else {
      this.bubbleContainer.style.left = (left / 14) + 'em';
      this.bubbleContainer.style.right = 'auto';
      this.bubblePointer.style.left = (3 / 14) + 'em';
      this.bubblePointer.style.right = 'auto';
      this.bubblePointer.style.backgroundPositionY = (-4 / 14) + 'em';
    }
    if (bottom + height + 2 > 360) {
      bottom = 360 - height - 2;
    }
    if (bottom < 19) {
      bottom = 19;
    }
    this.bubbleContainer.style.bottom = (bottom / 14) + 'em';

  };

  Base.prototype.createVariableWatcher = function(target, variableName) {

    return null;

  };

  Base.prototype.createListWatcher = function(target, listName) {

    return null;

  };

  Base.prototype.drawChild = function(ctx, c, noEffects) {
    const costume = c.costumes[c.currentCostumeIndex];

    if (this.stage.useWebGL) {

      const gl = ctx;
      const glShaderInfo = gl.useTouchingShader ? gl.touchingShaderInfo : gl.imgShaderInfo;

      if (costume.isScalable) {
        costume.requestSize(c.scale * costume.scale * c.stage.zoom * P.config.scale, c.scale * costume.scale * c.stage.zoom * P.config.scale);
      }

      if (!gl.costumeTextures.has(costume)) {
        const image = costume.getImage();
        const texture = glMakeTexture(gl, image);
        gl.costumeTextures.set(costume, texture);
      }

      gl.bindTexture(gl.TEXTURE_2D, gl.costumeTextures.get(costume));

      if (costume.isScalable) {
        if (costume.OnRequestSize) {
          costume.OnRequestSize = false;
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, costume.getImage());
        }
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, gl.imgBuffers.position);
      gl.vertexAttribPointer(glShaderInfo.attribLocations.position, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(glShaderInfo.attribLocations.position);

      const matrix = P.m3.projection(gl.canvas.width, gl.canvas.height);

      P.m3.multiply(matrix, gl.globalScaleMatrix);
      P.m3.multiply(matrix, P.m3.translation(240 + (Math.round(c.scratchX / this.stage.posFloor) * this.stage.posFloor), 180 - (Math.round(c.scratchY / this.stage.posFloor) * this.stage.posFloor)));
      
      if (c.isSprite) {
        if (c.rotationStyle === 0 && c.direction !== 90) {
          P.m3.multiply(matrix, P.m3.rotation(90 - c.direction));
        } else if (c.rotationStyle === 1 && c.direction < 0) {
          P.m3.multiply(matrix, P.m3.scaling(-1, 1));
        }
        if (c.scale !== 1) {
          P.m3.multiply(matrix, P.m3.scaling(c.scale, c.scale));
        }
      }

      P.m3.multiply(matrix, P.m3.scaling(costume.scale, costume.scale));
      P.m3.multiply(matrix, P.m3.translation(-costume.rotationCenterX, -costume.rotationCenterY));
      P.m3.multiply(matrix, P.m3.scaling(costume.width, costume.height));

      gl.uniformMatrix3fv(glShaderInfo.uniformLocations.matrix, false, matrix);
      
      if (!noEffects) {
        if (glShaderInfo.uniformLocations.u_opacity) {
          gl.uniform1f(glShaderInfo.uniformLocations.u_opacity, 1 - c.filters.ghost / 100);
        }
        if (glShaderInfo.uniformLocations.u_brightness) {
          gl.uniform1f(glShaderInfo.uniformLocations.u_brightness, c.filters.brightness / 100);
        }
        if (glShaderInfo.uniformLocations.u_color) {
          gl.uniform1f(glShaderInfo.uniformLocations.u_color, c.filters.color / 200);
        }
        if (glShaderInfo.uniformLocations.u_mosaic) {
          const mosaic = Math.round((Math.abs(c.filters.mosaic) + 10) / 10);
          gl.uniform1f(glShaderInfo.uniformLocations.u_mosaic, P.utils.clamp(mosaic, 1, 512));
        }
        if (glShaderInfo.uniformLocations.u_whirl) {
          gl.uniform1f(glShaderInfo.uniformLocations.u_whirl, c.filters.whirl * Math.PI / -180);
        }
        if (glShaderInfo.uniformLocations.u_fisheye) {
          gl.uniform1f(glShaderInfo.uniformLocations.u_fisheye, Math.max(0, (c.filters.fisheye + 100) / 100));
        }
        if (glShaderInfo.uniformLocations.u_pixelate) {
          gl.uniform1f(glShaderInfo.uniformLocations.u_pixelate, Math.abs(c.filters.pixelate) / 10);
        }
        if (glShaderInfo.uniformLocations.u_size) {
          gl.uniform2f(glShaderInfo.uniformLocations.u_size, costume.width, costume.height);
        }
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      ctx.save();
      const globalScale = c.stage.zoom * P.config.scale;
      ctx.translate(((c.scratchX + 240) * globalScale) / globalScale, ((180 - c.scratchY) * globalScale) / globalScale);
      let objectScale = costume.scale;
      if (c.isSprite) {
        if (c.rotationStyle === 0) {
            ctx.rotate((c.direction - 90) * Math.PI / 180);
        } else if (c.rotationStyle === 1 && c.direction < 0) {
            ctx.scale(-1, 1);
        }
        objectScale *= c.scale;
      }
      ctx.imageSmoothingEnabled = false;
      if (costume.isScalable) {
        costume.requestSize(objectScale * globalScale);
      }
      const image = costume.getImage();
      const x = -costume.rotationCenterX * objectScale;
      const y = -costume.rotationCenterY * objectScale;
      const w = Math.ceil(costume.width * objectScale);
      const h = Math.ceil(costume.height * objectScale);
      if (w < 1 || h < 1) {
        ctx.restore();
        return;
      }
      if (!noEffects) {
        ctx.globalAlpha = Math.max(0, Math.min(1, 1 - c.filters.ghost / 100));
        const filter = getCSSFilter(c.filters);
        if (filter !== '') {
          ctx.filter = filter;
        }
      }
      ctx.drawImage(image, x, y, w, h);
      ctx.restore();
    }

  };

  var Stage = function() {

    this.stage = this;

    Base.call(this);

    this.children = [];

    this.answer = '';
    this.promptId = 0;
    this.nextPromptId = 0;
    this.hidePrompt = false;
    this.timerStart = 0;
    this.zoom = 1;

    this.isStage = true;
    this.isComplete = false;
    this.volumeStage = 1;
    
    this.projectData = {};
    this.allWatchers = [];
    this.activeNotes = [];
    this.activeDrums = [];

    this.useWebGL = P.config.useWebGL;
    this.A_ConcurrencyCounterNotes = [];
    this._concurrencyCounter = 0;
    this.cursorPointer = false;
    
    this.posFloor = 1;
    this.overlay = {
      'SpriteCloneCount': 0,
      'FPS': 0,
      'WebGlCostuneTextureCount': 0,
      'Timer': 0,
      'MousePressed': 0,
      'step': 0,
    };
    this.rawMouseX = 0;
    this.rawMouseY = 0;
    this.mouseX = 0;
    this.mouseY = 0;

    this.mousePressed = false;
    this.tempoBPM = 60;
    this.username = 'player' + Math.random().toFixed(10).substr(2, 6);
    this.counter = 0;
    this.cloudHandler = null;
    this.cloudVariables = [];
    this.microphone = null;
    this.whenTimerMSecs = 0;
    this.tts = null;
    this.isSb3 = null;
    this.soundbankIsSB3 = true;
    this.currentMSecs = 0;
    this.extensions = [];
    this.useSpriteFencing = true;
    this.removeLimits = false;
    this.baseNow = 0;
    this.baseTime = 0;
    this.keys = [];
    this.keys.any = 0;
    this.root = document.createElement('div');
    this.root.classList.add('forkphorus-root');

    this.root.style.width = 480  + 'px';
    this.root.style.height = 360 + 'px';
    this.root.style['font-size'] = 10 + 'px';

    var tryWebGlcanvas = document.createElement('canvas');
    var tryWebGlcontext = tryWebGlcanvas.getContext('webgl', { alpha: true });

    if (!tryWebGlcontext) {
      this.useWebGL = false;
      tryWebGlcanvas.remove();
      tryWebGlcontext = null;
    }

    if (this.stage.useWebGL) {

      /********************   BACKDROP Canvas   ********************/

      this.backdropCanvas = document.createElement('canvas');
      this.backdropCanvas.setAttribute('id', 'backdropCanvas');
      this.backdropContext = this.backdropCanvas.getContext('webgl', { alpha: true });
      this.root.appendChild(this.backdropCanvas)
      setCostumeTexture(this.backdropContext);
      this.backdropContext.imgShader = initShaderProgram(this.backdropContext, Shader.imgVert, Shader.imgFrag,[
        'ENABLE_BRIGHTNESS',
        'ENABLE_COLOR',
        'ENABLE_GHOST',
        'ENABLE_FISHEYE',
        'ENABLE_MOSAIC',
        'ENABLE_PIXELATE',
        'ENABLE_WHIRL',
      ]);
      this.backdropContext.imgShaderInfo = {
        program: this.backdropContext.imgShader,
        attribLocations: {
          position: this.backdropContext.getAttribLocation(this.backdropContext.imgShader, 'a_position'),
          texcoord: this.backdropContext.getAttribLocation(this.backdropContext.imgShader, 'v_texcoord'),
        },
        uniformLocations: {
          matrix: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_matrix'),
          texture: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_texture'),
          u_brightness: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_brightness'),
          u_color: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_color'),
          u_opacity: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_opacity'),
          u_mosaic: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_mosaic'),
          u_whirl: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_whirl'),
          u_fisheye: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_fisheye'),
          u_pixelate: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_pixelate'),
          u_colorTest: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_colorTest'),
          u_size: this.backdropContext.getUniformLocation(this.backdropContext.imgShader, 'u_size'),
        },
        blendSource: this.backdropContext.SRC_ALPHA,
        blendDest: this.backdropContext.ONE_MINUS_SRC_ALPHA,
      }
      this.backdropContext.imgBuffers = initImgBuffers(this.backdropContext);
      this.backdropContext.globalScaleMatrix = P.m3.scaling(1 * P.config.scale, 1 * P.config.scale);

      /********************   PEN Canvas   ********************/

      this.penCanvas = document.createElement('canvas');
      this.penCanvas.setAttribute('id', 'penCanvas');
      this.penContext = this.penCanvas.getContext('webgl', { alpha: true, preserveDrawingBuffer: true });
      this.root.appendChild(this.penCanvas);
      setCostumeTexture(this.penContext);
      this.penCoords = new Float32Array(65536); 
      this.penLines = new Float32Array(32768);
      this.penColors = new Float32Array(65536);
      this.penCoordIndex = 0;
      this.penLineIndex = 0;
      this.penColorIndex = 0;
      this.penContext.penShader = initShaderProgram(this.penContext, Shader.penVert, Shader.penFrag);
      this.penContext.penShaderInfo = {
        program: this.penContext.penShader,
        attribLocations: {
          vertexData: this.penContext.getAttribLocation(this.penContext.penShader, 'vertexData'),
          lineData: this.penContext.getAttribLocation(this.penContext.penShader, 'lineData'),
          colorData: this.penContext.getAttribLocation(this.penContext.penShader, 'colorData'),
        },
        uniformLocations: {
          projectionMatrix: this.penContext.getUniformLocation(this.penContext.penShader, 'uProjectionMatrix'),
          modelViewMatrix: this.penContext.getUniformLocation(this.penContext.penShader, 'uModelViewMatrix'),
        },
      };
      this.penContext.penBuffers = {
        position: this.penContext.createBuffer(),
        line: this.penContext.createBuffer(),
        color: this.penContext.createBuffer(),
      };
      this.penContext.imgShader = initShaderProgram(this.penContext, Shader.imgVert, Shader.imgFrag,[
        'ENABLE_BRIGHTNESS',
        'ENABLE_COLOR',
        'ENABLE_GHOST',
        'ENABLE_FISHEYE',
        'ENABLE_MOSAIC',
        'ENABLE_PIXELATE',
        'ENABLE_WHIRL',
      ]);
      this.penContext.imgShaderInfo = {
        program: this.penContext.imgShader,
        attribLocations: {
          position: this.penContext.getAttribLocation(this.penContext.imgShader, 'a_position'),
          texcoord: this.penContext.getAttribLocation(this.penContext.imgShader, 'v_texcoord'),
        },
        uniformLocations: {
          matrix: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_matrix'),
          texture: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_texture'),
          u_brightness: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_brightness'),
          u_color: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_color'),
          u_opacity: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_opacity'),
          u_mosaic: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_mosaic'),
          u_whirl: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_whirl'),
          u_fisheye: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_fisheye'),
          u_pixelate: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_pixelate'),
          u_colorTest: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_colorTest'),
          u_size: this.penContext.getUniformLocation(this.penContext.imgShader, 'u_size'),
        },
        blendSource: this.penContext.SRC_ALPHA,
        blendDest: this.penContext.ONE_MINUS_SRC_ALPHA,
      }
      this.penContext.imgBuffers = initImgBuffers(this.penContext);
      this.penContext.globalScaleMatrix = P.m3.scaling(1 * P.config.scale, 1 * P.config.scale);

      /********************   COSTUME Canvas   ********************/

      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('id', 'canvas');
      this.context = this.canvas.getContext('webgl', { alpha: true });
      this.root.appendChild(this.canvas);
      setCostumeTexture(this.context);
      this.context.imgShader = initShaderProgram(this.context, Shader.imgVert, Shader.imgFrag,[
        'ENABLE_BRIGHTNESS',
        'ENABLE_COLOR',
        'ENABLE_GHOST',
        'ENABLE_FISHEYE',
        'ENABLE_MOSAIC',
        'ENABLE_PIXELATE',
        'ENABLE_WHIRL',
      ]);
      this.context.imgShaderInfo = {
        program: this.context.imgShader,
        attribLocations: {
          position: this.context.getAttribLocation(this.context.imgShader, 'a_position'),
          texcoord: this.context.getAttribLocation(this.context.imgShader, 'v_texcoord'),
        },
        uniformLocations: {
          matrix: this.context.getUniformLocation(this.context.imgShader, 'u_matrix'),
          texture: this.context.getUniformLocation(this.context.imgShader, 'u_texture'),
          u_brightness: this.context.getUniformLocation(this.context.imgShader, 'u_brightness'),
          u_color: this.context.getUniformLocation(this.context.imgShader, 'u_color'),
          u_opacity: this.context.getUniformLocation(this.context.imgShader, 'u_opacity'),
          u_mosaic: this.context.getUniformLocation(this.context.imgShader, 'u_mosaic'),
          u_whirl: this.context.getUniformLocation(this.context.imgShader, 'u_whirl'),
          u_fisheye: this.context.getUniformLocation(this.context.imgShader, 'u_fisheye'),
          u_pixelate: this.context.getUniformLocation(this.context.imgShader, 'u_pixelate'),
          u_colorTest: this.context.getUniformLocation(this.context.imgShader, 'u_colorTest'),
          u_size: this.context.getUniformLocation(this.context.imgShader, 'u_size'),
        },
        blendSource: this.context.SRC_ALPHA,
        blendDest: this.context.ONE_MINUS_SRC_ALPHA,
      }
      this.context.imgBuffers = initImgBuffers(this.context);
      this.context.globalScaleMatrix = P.m3.scaling(1, 1);

      /********************   COLLISION Canvas   ********************/

      this.glCollisionCanvas = document.createElement('canvas');
      this.glCollisionCanvas.setAttribute('id', 'glCollisionCanvas');
      this.glCollisionCanvas.width = 240;
      this.glCollisionCanvas.height = 180;
      this.glCollisionContext = this.glCollisionCanvas.getContext('webgl', { alpha: true });
      setCostumeTexture(this.glCollisionContext);

      //Scissor test for faster collision detection.
      this.glCollisionContext.enable(this.glCollisionContext.SCISSOR_TEST);
      this.glCollisionContext.scissor(0, 0, 240, 180);
      this.glCollisionContext.clearColor(0, 0, 0, 0);
      this.glCollisionContext.imgShader = initShaderProgram(this.glCollisionContext, Shader.imgVert, Shader.imgFrag,[
        'ENABLE_BRIGHTNESS',
        'ENABLE_COLOR',
        'ENABLE_GHOST',
        'ENABLE_FISHEYE',
        'ENABLE_MOSAIC',
        'ENABLE_PIXELATE',
        'ENABLE_WHIRL',
      ]);
      this.glCollisionContext.imgShaderInfo = {
        program: this.glCollisionContext.imgShader,
        attribLocations: {
          position: this.glCollisionContext.getAttribLocation(this.glCollisionContext.imgShader, 'a_position'),
          texcoord: this.glCollisionContext.getAttribLocation(this.glCollisionContext.imgShader, 'v_texcoord'),
        },
        uniformLocations: {
          matrix: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_matrix'),
          texture: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_texture'),
          u_brightness: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_brightness'),
          u_color: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_color'),
          u_opacity: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_opacity'),
          u_mosaic: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_mosaic'),
          u_whirl: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_whirl'),
          u_fisheye: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_fisheye'),
          u_pixelate: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_pixelate'),
          u_colorTest: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_colorTest'),
          u_size: this.glCollisionContext.getUniformLocation(this.glCollisionContext.imgShader, 'u_size'),
        },
        blendSource: this.glCollisionContext.SRC_ALPHA,
        blendDest: this.glCollisionContext.ONE_MINUS_SRC_ALPHA,
      }
      this.glCollisionContext.imgBuffers = initImgBuffers(this.glCollisionContext);
      this.glCollisionContext.touchingShader = initShaderProgram(this.glCollisionContext, Shader.imgVert, Shader.imgFrag,[
              'DISABLE_MINIMUM_ALPHA',
            ]);
      this.glCollisionContext.touchingShaderInfo = {
        program: this.glCollisionContext.touchingShader,
        attribLocations: {
          position: this.glCollisionContext.getAttribLocation(this.glCollisionContext.touchingShader, 'a_position'),
          texcoord: this.glCollisionContext.getAttribLocation(this.glCollisionContext.touchingShader, 'v_texcoord'),
        },
        uniformLocations: {
          matrix: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_matrix'),
          texture: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_texture'),
          u_brightness: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_brightness'),
          u_color: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_color'),
          u_opacity: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_opacity'),
          u_mosaic: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_mosaic'),
          u_whirl: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_whirl'),
          u_fisheye: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_fisheye'),
          u_pixelate: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_pixelate'),
          u_colorTest: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_colorTest'),
          u_size: this.glCollisionContext.getUniformLocation(this.glCollisionContext.touchingShader, 'u_size'),
        },
        blendSource: this.glCollisionContext.DST_ALPHA,
        blendDest: this.glCollisionContext.ZERO,
      }
      this.glCollisionContext.globalScaleMatrix = P.m3.scaling(0.5, 0.5);
      this.backdropContext.clearColor(0.0, 0.0, 0.0, 0.0);
      this.penContext.clearColor(0.0, 0.0, 0.0, 0.0);
      this.context.clearColor(0.0, 0.0, 0.0, 0.0);
      this.glCollisionContext.clearColor(0, 0, 0, 0);
      this.backdropContext.viewport(0, 0, 480 * P.config.scale, 360 * P.config.scale);
      this.penContext.viewport(0, 0, 480 * P.config.scale, 360 * P.config.scale);
      this.context.viewport(0, 0, 480 * P.config.scale, 360 * P.config.scale);
      this.glCollisionContext.viewport(0, 0, 240, 180);
      this.glCollisionCanvas.style['image-rendering'] = 'pixelated';
    } else {
      this.backdropCanvas = document.createElement('canvas');
      this.backdropContext = this.backdropCanvas.getContext("2d");
      this.penCanvas = document.createElement('canvas');
      this.penContext = this.penCanvas.getContext("2d");
      this.penContext.lineCap = 'round';
      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext("2d");
      this.root.appendChild(this.backdropCanvas);
      this.root.appendChild(this.penCanvas);
      this.root.appendChild(this.canvas);
    }
    this.backdropCanvas.style['image-rendering'] = 'pixelated';
    this.penCanvas.style['image-rendering'] = 'pixelated';
    this.canvas.style['image-rendering'] = 'pixelated';

    this.backdropCanvas.width = 480 * this.zoom * P.config.scale;
    this.backdropCanvas.height = 360 * this.zoom * P.config.scale;

    this.penCanvas.width = 480 * this.zoom * P.config.scale;
    this.penCanvas.height = 360 * this.zoom * P.config.scale;

    this.canvas.width = 480 * this.zoom * P.config.scale;
    this.canvas.height = 360 * this.zoom * P.config.scale;

    // This Camera Video
    this.CameraVideo = document.createElement('video');
    this.videoTransparency = 0;
    this.root.insertBefore(this.CameraVideo, this.penCanvas);
    this.cameraVideoIsOn = false;

    this.ui = document.createElement('div');
    this.root.appendChild(this.ui);
    this.ui.style.pointerEvents = 'none';
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';

    this.prompter = document.createElement('div');
    this.ui.appendChild(this.prompter);
    this.prompter.style.zIndex = '1';
    this.prompter.style.pointerEvents = 'auto';
    this.prompter.style.position = 'absolute';
    this.prompter.style.left =
    this.prompter.style.right = '1.4em';
    this.prompter.style.bottom = '.6em';
    this.prompter.style.padding = '.5em 3.0em .5em .5em';
    this.prompter.style.border = '.3em solid rgb(46, 174, 223)';
    this.prompter.style.borderRadius = '.8em';
    this.prompter.style.background = '#fff';
    this.prompter.style.display = 'none';

    this.promptTitle = document.createElement('div');
    this.prompter.appendChild(this.promptTitle);
    this.promptTitle.textContent = '';
    this.promptTitle.style.cursor = 'default';
    this.promptTitle.style.font = 'bold 1.3em sans-serif';
    this.promptTitle.style.margin = '0 ' + (-25 / 13) + 'em ' + (5 / 13) + 'em 0';
    this.promptTitle.style.whiteSpace = 'pre';
    this.promptTitle.style.overflow = 'hidden';
    this.promptTitle.style.textOverflow = 'ellipsis';

    this.prompt = document.createElement('input');
    this.prompter.appendChild(this.prompt);
    this.prompt.style.border = '0';
    this.prompt.style.background = '#eee';
    this.prompt.style.boxSizing = 'border-box';
    this.prompt.style.font = '1.3em sans-serif';
    this.prompt.style.padding = '0 ' + (3 / 13) + 'em';
    this.prompt.style.outline = '0';
    this.prompt.style.margin = '0';
    this.prompt.style.width = '100%';
    this.prompt.style.height = '' + (20 / 13) + 'em';
    this.prompt.style.display = 'block';
    this.prompt.style.borderRadius = '0';
    this.prompt.style.boxShadow = 'inset ' + (1 / 13) + 'em ' + (1 / 13) + 'em ' + (2 / 13) + 'em rgba(0, 0, 0, .2), inset ' + (-1 / 13) + 'em ' + (-1 / 13) + 'em ' + (1 / 13) + 'em rgba(255, 255, 255, .2)';
    this.prompt.style.webkitAppearance = 'none';
    
    this.promptButton = document.createElement('div');
    this.prompter.appendChild(this.promptButton);
    this.promptButton.style.width = '2.2em';
    this.promptButton.style.height = '2.2em';
    this.promptButton.style.position = 'absolute';
    this.promptButton.style.right = '.4em';
    this.promptButton.style.bottom = '.4em';
    this.promptButton.style.background = 'url(' + P.IO.config.localPath + 'icons.svg) -22.8em -0.4em';
    this.promptButton.style.backgroundSize = '38.4em 6.4em';

    this.addEventListeners();
    this.initRuntime();

  }

  inherits(Stage,Base);

  Stage.prototype.addEventListeners = function() {

    this._onmousedown = this._onmousedown.bind(this);
    this._onmouseup = this._onmouseup.bind(this);
    this._onmousemove = this._onmousemove.bind(this);
    this._ontouchstart = this._ontouchstart.bind(this);
    this._ontouchend = this._ontouchend.bind(this);
    this._ontouchmove = this._ontouchmove.bind(this);

    document.addEventListener('mousedown', this._onmousedown);
    document.addEventListener('mouseup', this._onmouseup);
    document.addEventListener('mousemove', this._onmousemove);
    document.addEventListener('touchstart', this._ontouchstart, { passive: false });
    document.addEventListener('touchend', this._ontouchend);
    document.addEventListener('touchmove', this._ontouchmove);

    this.root.addEventListener('wheel', this._onwheel.bind(this));
    this.root.addEventListener('keyup', this._onkeyup.bind(this));
    this.root.addEventListener('keydown', this._onkeydown.bind(this));
    this.promptButton.addEventListener('touchstart', this.submitPrompt.bind(this));
    this.promptButton.addEventListener('mousedown', this.submitPrompt.bind(this));
    this.prompt.addEventListener('keydown', (e) => {

      if (e.keyCode === 13) {

        this.submitPrompt();

      }

    });

  };

  var collisionCanvas = document.createElement('canvas');
  var collisionContext = collisionCanvas.getContext('2d');

  var collisionCanvas2 = document.createElement('canvas');
  var collisionContext2 = collisionCanvas2.getContext('2d');

  collisionContext.scale(0.5, 0.5);
  collisionContext2.scale(0.5, 0.5);

  Stage.prototype.removeEventListeners = function() {

    document.removeEventListener('mousedown', this._onmousedown);
    document.removeEventListener('mouseup', this._onmouseup);
    document.removeEventListener('mousemove', this._onmousemove);
    document.removeEventListener('touchstart', this._ontouchstart);
    document.removeEventListener('touchend', this._ontouchend);
    document.removeEventListener('touchmove', this._ontouchmove);

  };

  Stage.prototype.setZoom = function(scale) {
    if (this.zoom === scale)
      return;
   
    this.root.style.width = 480 * scale + 'px';
    this.root.style.height = 360 * scale + 'px';
    this.root.style['font-size'] = 10 * scale + 'px';
    this.resizeAllCanvas(scale);
    this.zoom = scale;
    
    for (const watcher of this.allWatchers) {
      if (watcher instanceof P.sb3.Scratch3ListWatcher) {
        watcher.updateList();
      }
    }
  };

  Stage.prototype.resizeAllCanvas = function(scale) {

    var ps = Math.min(scale * P.config.scale * 480, 1440) / 480;

    if (this.stage.useWebGL) {
      this.backdropCanvas.width = Math.ceil(480 * ps);
      this.backdropCanvas.height = Math.ceil(360 * ps);

      this.canvas.width = Math.ceil(480 * ps);
      this.canvas.height = Math.ceil(360 * ps);

      this.backdropContext.viewport(0, 0, Math.ceil(480 * ps), Math.ceil(360 * ps));
      this.context.viewport(0, 0, Math.ceil(480 * ps), Math.ceil(360 * ps));
      
      this.backdropContext.globalScaleMatrix = P.m3.scaling(scale * P.config.scale, scale * P.config.scale);
      this.context.globalScaleMatrix = P.m3.scaling(scale * P.config.scale, scale * P.config.scale);

      this.backdropContext.clearColor(0, 0, 0, 0);
      this.backdropContext.clear(this.backdropContext.COLOR_BUFFER_BIT);

      this.context.clearColor(0, 0, 0, 0);
      this.context.clear(this.context.COLOR_BUFFER_BIT);
     
      this.penContext.useProgram(this.penContext.imgShaderInfo.program);
 
      if (this.pendingPenOperations()) this.drawPendingOperations();

      var imgInfo = glMakeTexture(this.penContext, this.penCanvas);

      this.penCanvas.width = Math.ceil(480 * ps);
      this.penCanvas.height = Math.ceil(360 * ps);

      this.penContext.viewport(0, 0, Math.ceil(480 * ps), Math.ceil(360 * ps));
      this.penContext.globalScaleMatrix = P.m3.scaling(scale * P.config.scale, scale * P.config.scale);

      this.penContext.clearColor(0, 0, 0, 0);
      this.penContext.clear(this.penContext.COLOR_BUFFER_BIT);
      
      this.penContext.bindTexture(this.penContext.TEXTURE_2D, imgInfo);
      this.penContext.enableVertexAttribArray(this.penContext.imgShaderInfo.attribLocations.position);
      this.penContext.bindBuffer(this.penContext.ARRAY_BUFFER, this.penContext.imgBuffers.position);
      this.penContext.vertexAttribPointer(this.penContext.imgShaderInfo.attribLocations.position, 2, this.penContext.FLOAT, false, 0, 0);
      
      const matrix = P.m3.projection(this.penCanvas.width, this.penCanvas.height);
      P.m3.multiply(matrix, this.penContext.globalScaleMatrix);
      
      P.m3.multiply(matrix, P.m3.scaling(480, 360));

      this.penContext.uniformMatrix3fv(this.penContext.imgShaderInfo.uniformLocations.matrix, false, matrix);
      this.penContext.drawArrays(this.penContext.TRIANGLES, 0, 6);
      this.penContext.deleteTexture(imgInfo);
      imgInfo = null;

    } else {
      this.backdropCanvas.width = Math.ceil(480 * ps);
      this.backdropCanvas.height = Math.ceil(360 * ps);

      this.backdropContext.setTransform(ps, 0, 0, ps, 0, 0);
      const canvas = document.createElement('canvas');
      canvas.width = this.penCanvas.width;
      canvas.height = this.penCanvas.height;
      canvas.getContext('2d').drawImage(this.penCanvas, 0, 0, this.penCanvas.width, this.penCanvas.height);
      
      this.penCanvas.width = Math.ceil(480 * ps);
      this.penCanvas.height = Math.ceil(360 * ps);
      this.penContext.setTransform(ps, 0, 0, ps, 0, 0);
      this.penContext.drawImage(canvas, 0, 0, 480, 360);

      this.canvas.width = Math.ceil(480 * ps);
      this.canvas.height = Math.ceil(360 * ps);

      this.context.setTransform(ps, 0, 0, ps, 0, 0);
    }
    this.draw();
  };

  Stage.prototype.stamp = function () {}

  Stage.prototype._onwheel = function(e) {

    if (e.deltaY > 0) {
      this.trigger('whenKeyPressed', "down arrow");
    } else if (e.deltaY < 0) {
      this.trigger('whenKeyPressed', "up arrow");
    }

  };

  Stage.prototype.drawAllExcept = function(renderer, skip) {

    if (this.stage.useWebGL) renderer.useProgram(renderer.imgShaderInfo.program);
    this.drawChild(renderer,this);

    if (this.stage.useWebGL) {

      if (this.pendingPenOperations()) this.drawPendingOperations();

      var imgInfo = glMakeTexture(renderer, this.penCanvas);

      renderer.bindTexture(renderer.TEXTURE_2D, imgInfo);

      renderer.enableVertexAttribArray(renderer.imgShaderInfo.attribLocations.position);
      renderer.bindBuffer(renderer.ARRAY_BUFFER, renderer.imgBuffers.position);
      renderer.vertexAttribPointer(renderer.imgShaderInfo.attribLocations.position, 2, renderer.FLOAT, false, 0, 0);

      const matrix = P.m3.projection(renderer.canvas.width, renderer.canvas.height);
      P.m3.multiply(matrix, renderer.globalScaleMatrix);
      P.m3.multiply(matrix, P.m3.scaling(480, 360));

      renderer.uniformMatrix3fv(renderer.imgShaderInfo.uniformLocations.matrix, false, matrix);

      renderer.drawArrays(renderer.TRIANGLES, 0, 6);

      renderer.deleteTexture(imgInfo);
      imgInfo = null;

    } else {

      renderer.drawImage(this.penCanvas, 0, 0, 480, 360);

    }

    for (var i = 0; i < this.stage.children.length; i++) {

      var child = this.stage.children[i];

      if (!child.visible || child === skip) {
        continue;
      }

      this.drawChild(renderer,child);

    }

  };

  Stage.prototype.spriteTouchesColor = function(sprite, color) {};

  Stage.prototype.spriteColorTouchesColor = function(sprite, spriteColor, otherColor) {};

  Stage.prototype.keyEventToCode = function(e) {
    const key = e.key || '';

    switch (key) {
      case 'Enter': return "enter";
      case 'ArrowLeft':
      case 'Left': return "left arrow";
      case 'ArrowUp':
      case 'Up': return "up arrow";
      case 'ArrowRight':
      case 'Right': return "right arrow";
      case 'ArrowDown':
      case 'Down': return "down arrow";
    }

    return '' + key.toUpperCase().charCodeAt(0);

  };

  Stage.prototype.getAudioNodeStage = function () {

    if (this.nodeStage) {
      return this.nodeStage;
    }

    this.nodeStage = P.audioContext.createGain();
    this.nodeStage.gain.value = this.volumeStage;
    this.nodeStage.connect(P.audioContext.destination)
    return this.nodeStage;

  }

  Stage.prototype.screenshot = function() {

    if (this.stage.useWebGL) {
      this.context.clearColor(0, 0, 0, 0);
      this.context.clear(this.context.COLOR_BUFFER_BIT);
    } else {
      this.context.clearRect(0, 0, 480 * this.zoom * P.config.scale, 360 * this.zoom * this.zoom * P.config.scale);
    }
    this.drawAllExcept(this.context, null);
    this.canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = 'screenshot.png';
      a.click();
    });

  }

  Stage.prototype._onmousedown = function(e) {

    if (!this.isRunning)
      return;

    this.updateMousePosition(e);
    this.mousePressed = true;

    if (e.target === this.canvas) {
      this.clickMouse();
      e.preventDefault();
      this.canvas.focus();
    }

    this.onmousedown(e);

  };

  Stage.prototype._onmouseup = function(e) {

    if (!this.isRunning)
      return;

    this.updateMousePosition(e);
    this.releaseMouse();
    this.onmouseup(e);

  };

  Stage.prototype._onmousemove = function(e) {

    if (!this.isRunning)
      return;

    this.updateMousePosition(e);
    this.onmousemove(e);

  };

  Stage.prototype._ontouchstart = function(e) {

    if (!this.isRunning)
      return;

    this.mousePressed = true;

    for (var i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.updateMousePosition(t);
      if (e.target === this.canvas) {
        this.clickMouse();
      }
      this.ontouch(e, t);
    }

    if (e.target === this.canvas)
      e.preventDefault();

  };

  Stage.prototype._ontouchend = function(e) {

    if (!this.isRunning)
      return;
    this.releaseMouse();
    for (var i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.ontouch(e, t);
    }

  };

  Stage.prototype._ontouchmove = function(e) {

    if (!this.isRunning)
      return;

    this.updateMousePosition(e.changedTouches[0]);

    for (var i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      this.ontouch(e, t);
    }

  };

  Stage.prototype.focus = function() {

    if (this.promptId < this.nextPromptId) {

      this.prompt.focus();

    } else {

      this.canvas.focus();

    }

  };

  Stage.prototype.ontouch = function(e) {};

  Stage.prototype.onmousedown = function(e) {};

  Stage.prototype.onmouseup = function(e) {};

  Stage.prototype.onmousemove = function(e) {};

  Stage.prototype.updateMousePosition = function(e) {

    var rect = this.canvas.getBoundingClientRect();

    var x = (((e.clientX - rect.left) - (240 * this.zoom)) / this.zoom);
    var y = (((180 * this.zoom) - (e.clientY - rect.top)) / this.zoom);

    this.rawMouseX = x;
    this.rawMouseY = y;

    if (x < -240)
      x = -240;
    if (x > 240)
      x = 240;
    if (y < -180)
      y = -180;
    if (y > 180)
      y = 180;

    this.mouseX = Math.round(x);
    this.mouseY = Math.round(y);

  };

  Stage.prototype.destroy = function() {

    this.stopAll();
    this.pause();
    this.removeEventListeners();
    this.destroyCostume();

    for (var i = 0; i < this.children.length; i++) {
      this.children[i].destroyCostume();
    }

    if (this.useWebGL) {

      const backdropExtension = this.backdropContext.getExtension('WEBGL_lose_context');
      if (backdropExtension) {
        backdropExtension.loseContext();
      }

      const penExtension = this.penContext.getExtension('WEBGL_lose_context');
      if (penExtension) {
        penExtension.loseContext();
      }

      const contextExtension = this.context.getExtension('WEBGL_lose_context');
      if (contextExtension) {
        contextExtension.loseContext();
      }

      const glCollisionExtension = this.glCollisionContext.getExtension('WEBGL_lose_context');
      if (glCollisionExtension) {
        glCollisionExtension.loseContext();
      }

    }

    if (this.backdropCanvas) this.backdropCanvas.remove();
    if (this.penCanvas) this.penCanvas.remove();
    if (this.canvas) this.canvas.remove();
    if (this.glCollisionCanvas) this.glCollisionCanvas.remove();

    this.stage.root.remove();

  };

  Stage.prototype.submitPrompt = function() {

    if (this.promptId < this.nextPromptId) {

      this.answer = this.prompt.value;
      this.promptId += 1;

      if (this.promptId >= this.nextPromptId) {
        this.hidePrompt = true;
      }

    }

  };

  Stage.prototype.releaseMouse = function() {

    this.mousePressed = false;

    if (this.mouseSprite) {
      this.mouseSprite.mouseUp();
      this.mouseSprite = undefined;
    }

  };

  Stage.prototype.showVideo = function(visible) {

    if (!this.cameraVideoIsOn) {
      this.cameraVideoIsOn = true;
      this.CameraVideo.onloadedmetadata = () => {
          this.CameraVideo.play();
      };
      this.CameraVideo.style.opacity = this.videoTransparency;
      navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          .then((stream) => this.CameraVideo.srcObject = stream);
    }

    if (!visible) {
      this.CameraVideo.style.display = 'none';
    } else {
      this.CameraVideo.style = '';
      this.CameraVideo.style.opacity = this.videoTransparency;
    }

  };

  Stage.prototype.setVideoTransparency = function (TRANSPARENCY) {

    this.videoTransparency = TRANSPARENCY;
    if (this.cameraVideoIsOn) this.CameraVideo.style.opacity = this.videoTransparency;

  }

  Stage.prototype._onkeyup = function(e) {

    const c = this.keyEventToCode(e);
    if (c === null)
      return;
    if (this.keys[c])
      this.keys.any--;
    this.keys[c] = false;
    e.stopPropagation();
    if (e.target === this.canvas) {
      e.preventDefault();
    }

  };

  Stage.prototype._onkeydown = function(e) {

    const c = this.keyEventToCode(e);
    if (c === null)
      return;
    if (!this.keys[c])
      this.keys.any++;
    this.keys[c] = true;
    e.stopPropagation();
    if (e.target === this.canvas) {
      e.preventDefault();
      this.trigger('whenKeyPressed', c); 
    }

  };

  Stage.prototype.clickMouse = function() {

    this.mouseSprite = undefined;
    for (var i = this.children.length; i--;) {
      var c = this.children[i];
      if (c.visible && c.filters.ghost < 100 && c.touching("_mouse_")) {
        if (c.isDraggable) {
          this.mouseSprite = c;
          c.mouseDown();
        } else {
          this.triggerFor(c, 'whenClicked');
        }
        return;
      }
    }
    this.triggerFor(this, 'whenClicked');

  };

  Stage.prototype.getObject = function(name) {

    for (var i = 0; i < this.children.length; i++) {
      var c = this.children[i];
      if (c.name === name && !c.isClone) {
        return c;
      }
    }
    if (name === "_stage_" || name === this.name) {
      return this;
    }
    return null;

  };

  Stage.prototype.getObjects = function(name) {

    const result = [];

    for (var i = 0; i < this.children.length; i++) {
      if (this.children[i].name === name) {
        result.push(this.children[i]);
      }
    }

    return result;

  };

  Stage.prototype.drawPendingOperations = function () {
    const gl = this.penContext;
    gl.useProgram(gl.penShaderInfo.program);
    gl.viewport(0, 0, this.penCanvas.width, this.penCanvas.height);

    //set up position buffer for coordinates
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.penBuffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, this.penCoords, gl.STREAM_DRAW);
    gl.vertexAttribPointer(gl.penShaderInfo.attribLocations.vertexData, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.penShaderInfo.attribLocations.vertexData);
    
    //set up line description buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.penBuffers.line);
    gl.bufferData(gl.ARRAY_BUFFER, this.penLines,gl.STREAM_DRAW);
    gl.vertexAttribPointer(gl.penShaderInfo.attribLocations.lineData, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.penShaderInfo.attribLocations.lineData);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.penBuffers.color);
    
    //set up color buffer
    gl.bufferData(gl.ARRAY_BUFFER,this.penColors,gl.STREAM_DRAW);
    gl.vertexAttribPointer(gl.penShaderInfo.attribLocations.colorData, 4, gl.FLOAT,false, 0, 0);
    gl.enableVertexAttribArray(gl.penShaderInfo.attribLocations.colorData);

    //draw pen lines as triangles.
    gl.drawArrays(gl.TRIANGLES, 0, (this.penCoordIndex + 1) / 4);

    this.penCoordIndex = 0;
    this.penLineIndex = 0;
    this.penColorIndex = 0;
  }

  Stage.prototype.addExtension = function(extension) {
    this.extensions.push(extension);
  };

  Stage.prototype.setCloudHandler = function(cloudHandler) {
    this.cloudHandler = cloudHandler;
    this.addExtension(cloudHandler);
  };

  Stage.prototype.initMicrophone = function() {
    if (!this.microphone) {
      this.microphone = new P.ext.microphone.MicrophoneExtension(this);
      this.addExtension(this.microphone);
    }
  };

  Stage.prototype.initTextToSpeech = function() {
    if (!this.tts) {
      this.tts = new P.ext.tts.TextToSpeechExtension(this);
      this.addExtension(this.tts);
    }
  };

  Stage.prototype.pendingPenOperations = function () {
    return this.penLineIndex > 0;
  }

  Stage.prototype.getCircleResolution = function (size) {
    return Math.max(Math.ceil(Math.min(size, 50)), 3);
  }

  Stage.prototype.buffersCanFit = function(size) {
    return this.penCoordIndex + size > this.penCoords.length;
  }

  Stage.prototype.penLine = function(color, size, x, y, ox, oy) {
    if (this.stage.useWebGL) {
      const circleRes = this.getCircleResolution(size * this.zoom);
      // Redraw when array is full.
      if (this.buffersCanFit(24 * (circleRes + 1))) {
        this.drawPendingOperations();
      }
      x = +x;
      y = +y;
      ox = +ox;
      oy = +oy;
      x = (Math.round(x / 0.1) * 0.1);
      y = (Math.round(y / 0.1) * 0.1);
      ox = (Math.round(ox / 0.1) * 0.1);
      oy = (Math.round(oy / 0.1) * 0.1);
      if (x == y) {
        y += 0.001;
      };
      if (ox == oy) {
        oy -= 0.001;
      }
      if (x == ox) {
        x += 0.001;
      };
      if (y == oy) {
        y += 0.001;
      };
      // draw line

      // first triangle
      // first coordinates
      this.penCoords[this.penCoordIndex] = ox;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = oy;
      this.penCoordIndex++;

      // first coordinates supplement
      this.penCoords[this.penCoordIndex] = x;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = y;
      this.penCoordIndex++;

      //first vertex description
      this.penLines[this.penLineIndex] = -Math.PI / 2;
      this.penLineIndex++;
      this.penLines[this.penLineIndex] = size / 2;
      this.penLineIndex++;



      // second coordinates
      this.penCoords[this.penCoordIndex] = x;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = y;
      this.penCoordIndex++;

      // second coordinates supplement
      this.penCoords[this.penCoordIndex] = ox;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = oy;
      this.penCoordIndex++;

      //second vertex description
      this.penLines[this.penLineIndex] = Math.PI / 2;
      this.penLineIndex++;
      this.penLines[this.penLineIndex] = size / 2;
      this.penLineIndex++;



      // third coordinates
      this.penCoords[this.penCoordIndex] = ox;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = oy;
      this.penCoordIndex++;

      // third coordinates supplement
      this.penCoords[this.penCoordIndex] = x;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = y;
      this.penCoordIndex++;

      //second vertex description
      this.penLines[this.penLineIndex] = Math.PI / 2;
      this.penLineIndex++;
      this.penLines[this.penLineIndex] = size / 2;
      this.penLineIndex++;



      // second triangle
      // first coordinates
      this.penCoords[this.penCoordIndex] = ox;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = oy;
      this.penCoordIndex++;

      // first coordinates supplement
      this.penCoords[this.penCoordIndex] = x;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = y;
      this.penCoordIndex++;

      //first vertex description
      this.penLines[this.penLineIndex] = Math.PI / 2;
      this.penLineIndex++;
      this.penLines[this.penLineIndex] = size / 2;
      this.penLineIndex++;



      // second coordinates
      this.penCoords[this.penCoordIndex] = x;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = y;
      this.penCoordIndex++;

      // second coordinates supplement
      this.penCoords[this.penCoordIndex] = ox;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = oy;
      this.penCoordIndex++;

      //second vertex description
      this.penLines[this.penLineIndex] = -Math.PI / 2;
      this.penLineIndex++;
      this.penLines[this.penLineIndex] = size / 2;
      this.penLineIndex++;



      // third coordinates
      this.penCoords[this.penCoordIndex] = x;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = y;
      this.penCoordIndex++;

      // third coordinates supplement
      this.penCoords[this.penCoordIndex] = ox;
      this.penCoordIndex++;
      this.penCoords[this.penCoordIndex] = oy;
      this.penCoordIndex++;

      //second vertex description
      this.penLines[this.penLineIndex] = Math.PI / 2;
      this.penLineIndex++;
      this.penLines[this.penLineIndex] = size / 2;
      this.penLineIndex++;
      for (var i = 0; i < circleRes; i++) {

        // first endcap
        // first coordinates
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // first coordinates supplement
        this.penCoords[this.penCoordIndex] = ox;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = oy;
        this.penCoordIndex++;

        // first vertex description
        this.penLines[this.penLineIndex] = 0;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = 0;
        this.penLineIndex++;



        // second coordinates
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // second coordinates supplement
        this.penCoords[this.penCoordIndex] = ox;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = oy;
        this.penCoordIndex++;

        // second vertex description
        this.penLines[this.penLineIndex] = Math.PI / 2 + i / circleRes * Math.PI;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = size / 2;
        this.penLineIndex++;



        // third coordinates
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // third coordinates supplement
        this.penCoords[this.penCoordIndex] = ox;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = oy;
        this.penCoordIndex++;

        // third vertex description
        this.penLines[this.penLineIndex] = Math.PI / 2 + (i + 1) / circleRes * Math.PI;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = size / 2;
        this.penLineIndex++;



        // second endcap
        // first coordinates
        this.penCoords[this.penCoordIndex] = ox;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = oy;
        this.penCoordIndex++;

        // first coordinates supplement
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // first vertex description
        this.penLines[this.penLineIndex] = 0;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = 0;
        this.penLineIndex++;



        // second coordinates
        this.penCoords[this.penCoordIndex] = ox;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = oy;
        this.penCoordIndex++;

        // second coordinates supplement
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // second vertex description
        this.penLines[this.penLineIndex] = Math.PI / 2 + i / circleRes * Math.PI;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = size / 2;
        this.penLineIndex++;


        // third coordinates
        this.penCoords[this.penCoordIndex] = ox;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = oy;
        this.penCoordIndex++;

        // third coordinates supplement
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // third vertex description
        this.penLines[this.penLineIndex] = Math.PI / 2 + (i + 1) / circleRes * Math.PI;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = size / 2;
        this.penLineIndex++;
      }



      // set color of vertices
      const [r, g, b, a] = color.toParts();
      for (var i = 0; i < circleRes * 6 + 6; i++) {
        this.penColors[this.penColorIndex] = r;
        this.penColorIndex++;
        this.penColors[this.penColorIndex] = g;
        this.penColorIndex++;
        this.penColors[this.penColorIndex] = b;
        this.penColorIndex++;
        this.penColors[this.penColorIndex] = a;
        this.penColorIndex++;
      }
    } else {
      this.penContext.strokeStyle = color.toCSS();
      this.penContext.lineWidth = size;
      this.penContext.beginPath();
      this.penContext.lineCap = 'round';
      this.penContext.moveTo(240 + ox, 180 - oy);
      this.penContext.lineTo(240 + x, 180 - y);
      this.penContext.stroke();
    }
  };

  Stage.prototype.dotPen = function(color, size, x, y) {
    if (this.stage.useWebGL) {
      var circleRes = this.getCircleResolution(size * this.zoom);

      // Redraw when array is full.
      if (this.buffersCanFit(12 * circleRes)) {
        this.drawPendingOperations();
      }
      
      x = +x;
      y = +y;
      x = (Math.round(x / 0.1) * 0.1);
      y = (Math.round(y / 0.1) * 0.1);
      if (x == y) {
        y += 0.001;
        x -= 0.001;
      };

      for (var i = 0; i < circleRes; i++) {
        // first endcap
        // first coordinates
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // first coordinates supplement
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;

        // first vertex description
        this.penLines[this.penLineIndex] = 0;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = 0;
        this.penLineIndex++;



        // second coordinates
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // second coordinates supplement
        this.penCoords[this.penCoordIndex] = x + 1;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y + 1;
        this.penCoordIndex++;

        // second vertex description
        this.penLines[this.penLineIndex] = Math.PI / 2 + (i - 1) / circleRes * 2 * Math.PI;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = size / 2;
        this.penLineIndex++;



        // third coordinates
        this.penCoords[this.penCoordIndex] = x;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y;
        this.penCoordIndex++;

        // third coordinates supplement
        this.penCoords[this.penCoordIndex] = x + 1;
        this.penCoordIndex++;
        this.penCoords[this.penCoordIndex] = y + 1;
        this.penCoordIndex++;

        // third vertex description
        this.penLines[this.penLineIndex] = Math.PI / 2 + i / circleRes * 2 * Math.PI;
        this.penLineIndex++;
        this.penLines[this.penLineIndex] = size / 2;
        this.penLineIndex++;
      }

      // set color of vertices
      const [r, g, b, a] = color.toParts();
      for (var i = 0; i < circleRes * 3; i++) {
        this.penColors[this.penColorIndex] = r;
        this.penColorIndex++;
        this.penColors[this.penColorIndex] = g;
        this.penColorIndex++;
        this.penColors[this.penColorIndex] = b;
        this.penColorIndex++;
        this.penColors[this.penColorIndex] = a;
        this.penColorIndex++;
      }
    } else {
      this.penContext.fillStyle = color.toCSS();
      this.penContext.beginPath();
      this.penContext.lineCap = 'round';
      this.penContext.arc(240 + x, 180 - y, size / 2, 0, 2 * Math.PI, false);
      this.penContext.fill();
    }
  };

  Stage.prototype.spritesIntersect = function() {};

  Stage.prototype.stopAllSounds = function() {
    for (var children = this.children, i = children.length; i--;) {
      children[i].stopSounds();
    }
    this.stopSounds();
    this.A_ConcurrencyCounterNotes.length = 0;
  };

  Stage.prototype.rotatedBounds = function() {
    return {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    };
  };

  Stage.prototype.getPosition = function(name) {
    switch (name) {
      case "_mouse_": return {
        x: this.mouseX,
        y: this.mouseY,
      };
      case "_random_": return {
        x: Math.round(480 * Math.random() - 240),
        y: Math.round(360 * Math.random() - 180),
      };
    }
    const sprite = this.getObject(name);
    if (!sprite)
      return null;
    return {
      x: sprite.scratchX,
      y: sprite.scratchY,
    };
  };

  Stage.prototype.draw = function() {

    if (this.stage.useWebGL) {
      this.backdropContext.clear(this.backdropContext.COLOR_BUFFER_BIT);
      this.context.clear(this.context.COLOR_BUFFER_BIT);
      this.backdropContext.useProgram(this.backdropContext.imgShaderInfo.program);
      this.penContext.useProgram(this.penContext.imgShaderInfo.program);
      this.context.useProgram(this.context.imgShaderInfo.program);
    } else {
      this.backdropContext.clearRect(0, 0, 480, 360);
      this.context.clearRect(0, 0, 480, 360);
    }

    this.drawChild(this.stage.backdropContext,this)
    for (var i = 0; i < this.children.length; i++) {
      if (!this.children[i].visible) continue;
      this.drawChild(this.stage.context, this.children[i]);
    }

    if (this.stage.useWebGL) {
      if (this.pendingPenOperations()) {
        this.drawPendingOperations();
      }
    }

    for (var i = this.allWatchers.length; i--;) {
      var w = this.allWatchers[i];
      if (w.visible) {
        w.update();
      }
    }

    if (this.hidePrompt) {
      this.hidePrompt = false;
      this.prompter.style.display = 'none';
      this.canvas.focus();
    }

  };

  var Sprite = function (stage) {
    Base.call(this);
    this.isSprite = true;
    this.isClone = false;
    this.direction = 90;
    this.rotationStyle = 0;
    this.isDraggable = false;
    this.isDragging = false;
    this.scale = 1;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.stage = stage;
  }

  inherits(Sprite,Base);

  Sprite.prototype.mouseDown = function(steps) {
    this.dragStartX = this.scratchX;
    this.dragStartY = this.scratchY;
    this.dragOffsetX = this.scratchX - this.stage.mouseX;
    this.dragOffsetY = this.scratchY - this.stage.mouseY;
    this.isDragging = true;
  };

  Sprite.prototype.stamp = function() {

    if (this.stage.useWebGL) {
      if (this.stage.pendingPenOperations()) {
        this.stage.drawPendingOperations();
      }
      this.stage.penContext.useProgram(this.stage.penContext.imgShaderInfo.program); 
    }

    this.stage.drawChild(this.stage.penContext,this);

  };

  Sprite.prototype.mouseUp = function(steps) {

    if (this.isDragging && this.scratchX === this.dragStartX && this.scratchY === this.dragStartY) {
      this.stage.triggerFor(this, 'whenClicked');
    }

    this.isDragging = false;

  };

  Sprite.prototype.setDirection = function(degrees) {

    var d = degrees % 360;
    if (d > 180)
      d -= 360;
    if (d <= -180)
      d += 360;
    this.direction = d;

  };

  Sprite.prototype.distanceTo = function(thing) {

    const p = this.stage.getPosition(thing);

    if (!p) {
      return 10000;
    }

    const x = p.x;
    const y = p.y;
    return Math.sqrt((this.scratchX - x) * (this.scratchX - x) + (this.scratchY - y) * (this.scratchY - y));

  };

  Sprite.prototype.touchingColor = function(color) {

    if (this.stage.useWebGL) {

      collisionContext.clearRect(0,0,480,360);
      const b = this.rotatedBounds();
      const width = b.right - b.left;
      const height = b.top - b.bottom;

      if (width < 1 || height < 1 || width !== width || height !== height) {
        return false;
      }

      collisionCanvas.width = Math.max(width / 2, 1);
      collisionCanvas.height =  Math.max(height / 2, 1);

      collisionContext.fillStyle = 'white';
      collisionContext.fillRect(0, 0, width, height);
      collisionContext.save();
      collisionContext.translate(-((240 + b.left) / 2), -((180 - b.top) / 2));

      collisionContext.imageSmoothingEnabled = false;

      this.stage.glCollisionContext.useTouchingShader = false;
      this.stage.glCollisionContext.useProgram(this.stage.glCollisionContext.imgShaderInfo.program);
      this.stage.glCollisionContext.clear(this.stage.glCollisionContext.COLOR_BUFFER_BIT);

      this.stage.drawAllExcept(this.stage.glCollisionContext, this);

      collisionContext.drawImage(this.stage.glCollisionCanvas, 0, 0, 240, 180)
      collisionContext.globalCompositeOperation = 'destination-in';

      this.stage.glCollisionContext.clear(this.stage.glCollisionContext.COLOR_BUFFER_BIT);

      this.drawChild(this.stage.glCollisionContext,this);

      collisionContext.imageSmoothingEnabled = false;

      collisionContext.drawImage(this.stage.glCollisionCanvas, 0, 0, 240, 180);
      collisionContext.restore();

      const data = collisionContext.getImageData(0, 0, Math.max(width / 2, 1), Math.max(height / 2, 1)).data;

      color = color & COLOR_MASK;
      const length = data.length;
      for (var i = 0; i < length; i += 4) {
        if (((data[i] << 16 | data[i + 1] << 8 | data[i + 2]) & COLOR_MASK) === color && data[i + 3]) {
          return true;
        }
      }
      return false;
    } else {

      var b = this.rotatedBounds();
      const width = b.right - b.left;
      const height = b.top - b.bottom;

      if (width < 1 || height < 1 || width !== width || height !== height) {
        return false;
      }

      collisionCanvas.width = Math.max(width, 1);
      collisionCanvas.height = Math.max(height, 1);

      collisionContext.fillStyle = 'white';
      collisionContext.fillRect(0, 0, collisionCanvas.width, collisionCanvas.height);
      collisionContext.save();
      collisionContext.translate(-(240 + b.left), -(180 - b.top));
      this.stage.drawAllExcept(collisionContext, this);
      collisionContext.globalCompositeOperation = 'destination-in';
      this.stage.drawChild(collisionContext, this);
      collisionContext.restore();
      var data = collisionContext.getImageData(0, 0, Math.max(width, 1), Math.max(height, 1)).data;
      color = color & COLOR_MASK;
      var length = data.length;

      for (var i = 0; i < length; i += 4) {
        if (((data[i] << 16 | data[i + 1] << 8 | data[i + 2]) & COLOR_MASK) === color && data[i + 3]) {
          return true;
        }
      }
      return false;
    }

  };

  Sprite.prototype.colorTouchingColor = function(sourceColor, touchingColor) {

    var rb = this.rotatedBounds();
    const width = rb.right - rb.left;
    const height = rb.top - rb.bottom;

    if (width < 1 || height < 1 || width !== width || height !== height) {
      return false;
    }

    if (this.stage.useWebGL) {

      collisionCanvas.width = collisionCanvas2.width = Math.max(width / 2, 1);
      collisionCanvas.height = collisionCanvas2.height = Math.max(height / 2, 1);
      collisionContext.save();
      collisionContext2.save();
      collisionContext.translate(-((240 + rb.left) / 2), -((180 - rb.top) / 2));
      collisionContext2.translate(-((240 + rb.left) / 2), -((180 - rb.top) / 2));

      this.stage.glCollisionContext.useTouchingShader = false;
      this.stage.glCollisionContext.useProgram(this.stage.glCollisionContext.imgShaderInfo.program);
      this.stage.glCollisionContext.clear(this.stage.glCollisionContext.COLOR_BUFFER_BIT);

      this.stage.drawAllExcept(this.stage.glCollisionContext, this);

      collisionContext.imageSmoothingEnabled = false;

      collisionContext.drawImage(this.stage.glCollisionCanvas, 0, 0, 240, 180);

      this.stage.glCollisionContext.clear(this.stage.glCollisionContext.COLOR_BUFFER_BIT);
      this.drawChild(this.stage.glCollisionContext,this);

      collisionContext2.imageSmoothingEnabled = false;

      collisionContext2.drawImage(this.stage.glCollisionCanvas, 0, 0, 240, 180);
      collisionContext.restore();
      collisionContext2.restore();

      var dataA = collisionContext.getImageData(0, 0, Math.max(width / 2, 1), Math.max(height / 2, 1)).data;
      var dataB = collisionContext2.getImageData(0, 0, Math.max(width / 2, 1), Math.max(height / 2, 1)).data;

      sourceColor = sourceColor & COLOR_MASK;
      touchingColor = touchingColor & COLOR_MASK;

      var length = dataA.length;

      for (var i = 0; i < length; i += 4) {
        var touchesSource = ((dataB[i] << 16 | dataB[i + 1] << 8 | dataB[i + 2]) & COLOR_MASK) === sourceColor && dataB[i + 3];
        var touchesOther = ((dataA[i] << 16 | dataA[i + 1] << 8 | dataA[i + 2]) & COLOR_MASK) === touchingColor && dataA[i + 3];
        if (touchesSource && touchesOther) {
          return true;
        }
      }
      return false;

    } else {
      collisionCanvas.width = collisionCanvas2.width = Math.max(width, 1);
      collisionCanvas.height = collisionCanvas2.height = Math.max(height, 1);
      collisionContext.save();
      collisionContext2.save();
      collisionContext.translate(-(240 + rb.left), -(180 - rb.top));
      collisionContext2.translate(-(240 + rb.left), -(180 - rb.top));

      this.stage.drawAllExcept(collisionContext, this);

      this.drawChild(collisionContext2, this);

      collisionContext.restore();
      collisionContext2.restore();

      var dataA = collisionContext.getImageData(0, 0, Math.max(width, 1), Math.max(height, 1)).data;
      var dataB = collisionContext2.getImageData(0, 0, Math.max(width, 1), Math.max(height, 1)).data;

      sourceColor = sourceColor & COLOR_MASK;
      touchingColor = touchingColor & COLOR_MASK;

      var length = dataA.length;
      for (var i = 0; i < length; i += 4) {
        var touchesSource = ((dataB[i] << 16 | dataB[i + 1] << 8 | dataB[i + 2]) & COLOR_MASK) === sourceColor && dataB[i + 3];
        var touchesOther = ((dataA[i] << 16 | dataA[i + 1] << 8 | dataA[i + 2]) & COLOR_MASK) === touchingColor && dataA[i + 3];
        if (touchesSource && touchesOther) {
          return true;
        }
      }
      return false;
    }
  };

  Sprite.prototype.bounceOffEdge = function() {

    var b = this.rotatedBounds();
    var dl = 240 + b.left;
    var dt = 180 - b.top;
    var dr = 240 - b.right;
    var db = 180 + b.bottom;
    var d = Math.min(dl, dt, dr, db);
    if (d > 0)
      return;
    var dir = this.direction * Math.PI / 180;
    var dx = Math.sin(dir);
    var dy = -Math.cos(dir);
    switch (d) {
      case dl:
        dx = Math.max(0.2, Math.abs(dx));
        break;
      case dt:
        dy = Math.max(0.2, Math.abs(dy));
        break;
      case dr:
        dx = -Math.max(0.2, Math.abs(dx));
        break;
      case db:
        dy = -Math.max(0.2, Math.abs(dy));
        break;
    }
    this.direction = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    if (this.saying)
      this.updateBubble();

  };

  Sprite.prototype.pointTowards = function(thing) {

    const position = this.stage.getPosition(thing);

    if (!position) {
      return 0;
    }

    const dx = position.x - this.scratchX;
    const dy = position.y - this.scratchY;
    this.direction = dx === 0 && dy === 0 ? 90 : Math.atan2(dx, dy) * 180 / Math.PI;
    if (this.saying)
      this.updateBubble();

  };

  Sprite.prototype.clone = function() {

    const clone = new Sprite(null);
    clone.isClone = true;

    for (const key of Object.keys(this.vars)) {
      clone.vars[key] = this.vars[key];
    }

    for (const key of Object.keys(this.lists)) {
      clone.lists[key] = this.lists[key].slice(0);
    }

    clone.filters = {

      color: this.filters.color,

      fisheye: this.filters.fisheye,

      whirl: this.filters.whirl,

      pixelate: this.filters.pixelate,

      mosaic: this.filters.mosaic,

      brightness: this.filters.brightness,

      ghost: this.filters.ghost

    };

    clone.procedures = this.procedures;
    clone.listeners = this.listeners;
    clone.fns = this.fns;
    clone.name = this.name;
    clone.costumes = this.costumes;
    clone.currentCostumeIndex = this.currentCostumeIndex;
    clone.sounds = this.sounds;
    clone.soundRefs = this.soundRefs;
    clone.direction = this.direction;
    clone.instrument = this.instrument;
    clone.isDraggable = this.isDraggable;
    clone.rotationStyle = this.rotationStyle;
    clone.scale = this.scale;
    clone.volume = this.volume;
    clone.scratchX = this.scratchX;
    clone.scratchY = this.scratchY;
    clone.visible = this.visible;
    clone.penSize = this.penSize;
    clone.penColor.copy(this.penColor);
    clone.isPenDown = this.isPenDown;
    clone.watchers = this.watchers;
    clone.listWatchers = this.listWatchers;
    clone.stage = this.stage;

    return clone;

  };

  Sprite.prototype.keepInView = function() {

    const rb = this.rotatedBounds();
    const width = Math.ceil(rb.right - rb.left)
    const height = Math.ceil(rb.top - rb.bottom);
    const bounds = Math.min(15, Math.floor(Math.min(width, height) / 2));

    if (rb.right - bounds < -240) {
      this.scratchX -= rb.right - bounds + 240;
    }
    if (rb.left + bounds > 240) {
      this.scratchX -= rb.left + bounds - 240;
    }
    if (rb.bottom + bounds > 180) {
      this.scratchY -= rb.bottom + bounds - 180;
    }
    if (rb.top - bounds < -180) {
      this.scratchY -= rb.top - bounds + 180;
    }

  };

  Sprite.prototype.moveTo = function(x,y) {

    if (x > 100000000000) x = 100000000000;
    if (y > 100000000000) y = 100000000000;
    if (x < -100000000000) x = -100000000000;
    if (y < -100000000000) y = -100000000000;

    var ox = this.scratchX;
    var oy = this.scratchY;

    if (ox === x && oy === y && !this.isPenDown) {
      return;
    }

    this.scratchX = x;
    this.scratchY = y;

    if (this.stage.useSpriteFencing) {
      this.keepInView();
    }

    if (this.isPenDown && !this.isDragging) {
      this.stage.penLine(this.penColor, this.penSize, ox, oy, x, y);
    }

    if (this.saying) {
      this.updateBubble();
    }

  };

  Sprite.prototype.forward = function(steps) {

    const d = (90 - this.direction) * Math.PI / 180;
    this.moveTo(this.scratchX + steps * (Math.round(Math.cos(d) * 1e10) / 1e10), this.scratchY + steps * (Math.round(Math.sin(d) * 1e10) / 1e10));

  };

  Sprite.prototype.dotPen = function() {

    this.stage.dotPen(this.penColor, this.penSize, this.scratchX, this.scratchY);

  };

  Sprite.prototype.touching = function(thing) {

    if (thing === "_mouse_") {

      if (this.stage.useWebGL) {

        const bounds = this.rotatedBounds();

        var x = this.stage.rawMouseX;
        var y = this.stage.rawMouseY;

        if (x < bounds.left || y < bounds.bottom || x > bounds.right || y > bounds.top || this.scale === 0) {
          
          return false;

        }

        const cx = (240 + x) / 2;
        const cy = (180 + y) / 2;

        this.stage.glCollisionContext.scissor(cx, cy, 1, 1);
        this.stage.glCollisionContext.clear(this.stage.glCollisionContext.COLOR_BUFFER_BIT);
        this.stage.glCollisionContext.useProgram(this.stage.glCollisionContext.imgShaderInfo.program);
        this.stage.glCollisionContext.useTouchingShader = false;

        this.drawChild(this.stage.glCollisionContext,this);

        const result = new Uint8Array(4);
        
        this.stage.glCollisionContext.readPixels(cx, cy, 1, 1, this.stage.glCollisionContext.RGBA, this.stage.glCollisionContext.UNSIGNED_BYTE, result);
        this.stage.glCollisionContext.scissor(0, 0, 240, 180);

        return result[3] !== 0;

      } else {

        const bounds = this.rotatedBounds();

        var x = this.stage.rawMouseX;
        var y = this.stage.rawMouseY;

        if (x < bounds.left || y < bounds.bottom || x > bounds.right || y > bounds.top || this.scale === 0) {

          return false;

        }

        const costume = this.costumes[this.currentCostumeIndex];
        
        var cx = (x - this.scratchX) / this.scale;
        var cy = (this.scratchY - y) / this.scale;

        if (this.rotationStyle === 0 && this.direction !== 90) {

          const d = (90 - this.direction) * Math.PI / 180;
          const ox = cx;
          const s = Math.sin(d), c = Math.cos(d);
          cx = c * ox - s * cy;
          cy = s * ox + c * cy;

        } else if (this.rotationStyle === 1 && this.direction < 0) {

          cx = -cx;

        }

        let positionX = Math.round(cx / costume.scale + costume.rotationCenterX);
        let positionY = Math.round(cy / costume.scale + costume.rotationCenterY);

        if (costume instanceof VectorCostume) {

          positionX *= costume.currentScale;
          positionY *= costume.currentScale;

        }

        if (!Number.isFinite(positionX) || !Number.isFinite(positionY)) {

          return false;

        }

        const data = costume.getContext().getImageData(positionX, positionY, 1, 1).data;

        return data[3] !== 0;

      }

    } else if (thing === "_edge_") {

      const bounds = this.rotatedBounds();

      return bounds.left <= -240 || bounds.right >= 240 || bounds.top >= 180 || bounds.bottom <= -180;

    } else {
      if (!this.visible) return false;

      const mb = this.rotatedBounds();

      const sprites = this.stage.getObjects(thing);

      for (const spriteB of sprites) {

        if (!spriteB.visible || this === spriteB) continue;

        const ob = spriteB.rotatedBounds();

        if (mb.bottom >= ob.top || ob.bottom >= mb.top || mb.left >= ob.right || ob.left >= mb.right) {
          continue;
        }

        const left = Math.max(mb.left, ob.left);
        const top = Math.min(mb.top, ob.top);
        const right = Math.min(mb.right, ob.right);
        const bottom = Math.max(mb.bottom, ob.bottom);

        if (this.stage.useWebGL) {
          const width = right - left;
          const height = top - bottom;
          if (width < 1 || height < 1 || width !== width || height !== height) {
            continue;
          }

          collisionCanvas.width = width / 2;
          collisionCanvas.height = height / 2;

          collisionContext.clearRect(0, 0, 480, 360);

          collisionContext.save();
          collisionContext.translate(-((left + 240) / 2), -((180 - top) / 2));

          this.stage.glCollisionContext.clear(this.stage.glCollisionContext.COLOR_BUFFER_BIT);
          this.stage.glCollisionContext.useProgram(this.stage.glCollisionContext.imgShaderInfo.program);
          
          this.stage.glCollisionContext.useTouchingShader = false;
          this.drawChild(this.stage.glCollisionContext, this, true);

          collisionContext.imageSmoothingEnabled = false;
          collisionContext.drawImage(this.stage.glCollisionCanvas, 0, 0, 240, 180);

          collisionContext.globalCompositeOperation = 'source-in';

          this.stage.glCollisionContext.clear(this.stage.glCollisionContext.COLOR_BUFFER_BIT);
          
          this.stage.glCollisionContext.useTouchingShader = false;
          this.drawChild(this.stage.glCollisionContext, spriteB, true);
          collisionContext.drawImage(this.stage.glCollisionCanvas, 0, 0, 240, 180);
          
          collisionContext.restore();
          
          var data = collisionContext.getImageData(0, 0, Math.max(width / 2, 1), Math.max(height / 2, 1)).data;
          var length = data.length;
          for (var j = 0; j < length; j += 4) {
            if (data[j + 3] > 5) {
              return true;
            }
          }
        } else {

          const width = right - left;
          const height = top - bottom;

          if (right - left < 1 || top - bottom < 1 || right - left !== right - left || top - bottom !== top - bottom) {
            continue;
          }

          collisionCanvas.width = Math.max(width, 1);
          collisionCanvas.height = Math.max(height, 1);

          collisionContext.save();
          collisionContext.translate(-(left + 240), -(180 - top));

          this.drawChild(collisionContext, this, true);

          collisionContext.globalCompositeOperation = 'source-in';

          this.drawChild(collisionContext, spriteB, true);

          collisionContext.restore();

          var data = collisionContext.getImageData(0, 0, Math.max(width, 1), Math.max(height, 1)).data;

          var length = data.length;

          for (var j = 0; j < length; j += 4) {
            if (data[j + 3]) {
              return true;
            }
          }
        }
      }
      return false;
    }
  };

  Sprite.prototype.rotatedBounds = function() {

    var costume = this.costumes[this.currentCostumeIndex];
    var s = costume.scale * this.scale;
    var left = -costume.rotationCenterX * s;
    var top = costume.rotationCenterY * s;
    var right = left + costume.width * s;
    var bottom = top - costume.height * s;

    if (costume.width * costume.scale - 1 < 1 || costume.height * costume.scale - 1 < 1) {
      left = 0;
      top = 0;
      right = 0;
      bottom = 0;
    }

    if (this.rotationStyle !== 0) {
      if (this.rotationStyle === 1 && this.direction < 0) {
        right = -left;
        left = right - costume.width * costume.scale * this.scale;
      }
      return {
        left: this.scratchX + left,
        right: this.scratchX + right,
        top: this.scratchY + top,
        bottom: this.scratchY + bottom
      };
    }

    var mSin = Math.sin(this.direction * Math.PI / 180);
    var mCos = Math.cos(this.direction * Math.PI / 180);

    var tlX = mSin * left - mCos * top;
    var tlY = mCos * left + mSin * top;
    var trX = mSin * right - mCos * top;
    var trY = mCos * right + mSin * top;
    var blX = mSin * left - mCos * bottom;
    var blY = mCos * left + mSin * bottom;
    var brX = mSin * right - mCos * bottom;
    var brY = mCos * right + mSin * bottom;

    return {
      left: this.scratchX + Math.min(tlX, trX, blX, brX),
      right: this.scratchX + Math.max(tlX, trX, blX, brX),
      top: this.scratchY + Math.max(tlY, trY, blY, brY),
      bottom: this.scratchY + Math.min(tlY, trY, blY, brY)
    };

  };

  Sprite.prototype.gotoObject = function(thing) {

    const position = this.stage.getPosition(thing);
    if (!position) {
      return 0;
    }
    this.moveTo(position.x, position.y);

  };

  var Costume = function(costumeData) {

    this.name = costumeData.name;
    this.scale = 1 / (costumeData.bitmapResolution || 1);
    this.rotationCenterX = costumeData.rotationCenterX;
    this.rotationCenterY = costumeData.rotationCenterY;

  }

  var BitmapCostume = function(image, options) {

    Costume.call(this, options);
    if (image.tagName === 'CANVAS') {
      const ctx = image.getContext('2d');
      this.ctx = ctx;
    }
    this.image = image;
    this.width = Math.max(image.width, 0);
    this.height = Math.max(image.height, 0);
    this.isScalable = false;

  }

  BitmapCostume.prototype.getContext = function() {

    if (this.ctx) {
      return this.ctx;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = this.width;
    canvas.height = this.height;
    ctx.drawImage(this.image, 0, 0);
    this.ctx = ctx;
    return ctx;

  }

  BitmapCostume.prototype.getImage = function() {
    return this.image;
  }

  BitmapCostume.prototype.requestSize = function(scale) {
    throw new Error(`requestSize is not implemented on BitmapCostume "${this.name}" isScalable=${this.isScalable}`);
  }

  BitmapCostume.prototype.destroy = function() {
    this.image.remove();
  }

  var VectorCostume = function(svg, options) {

    Costume.call(this, options);

    if (svg.height < 1 || svg.width < 1) {
      svg = new Image(1, 1);
    }

    this.isScalable = true;
    this.OnRequestSize = true;
    this.width = svg.width;
    this.height = svg.height;
    this.svg = svg;
    this.maxScale = this.calculateMaxScale();
    this.currentScale = Math.min(1, this.maxScale);

  }

  VectorCostume.prototype.calculateMaxScale = function() {

    if (VectorCostume.MAX_SIZE / this.width < VectorCostume.MAX_SCALE) {
        return VectorCostume.MAX_SIZE / this.width;
    }

    if (VectorCostume.MAX_SIZE / this.height < VectorCostume.MAX_SCALE) {
        return VectorCostume.MAX_SIZE / this.height;
    }

    return VectorCostume.MAX_SCALE;

  };

  VectorCostume.prototype.render = function() {

    const width = Math.floor(Math.max(1, this.width * this.currentScale));
    const height = Math.floor(Math.max(1, this.height * this.currentScale));

    if (!this.canvas) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      this.canvas = canvas;
      this.ctx = ctx;
    } else {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.svg, 0, 0, width, height);

  };

  VectorCostume.prototype.requestSize = function(costumeScale) {

    if (VectorCostume.DISABLE_RASTERIZE) {
      return;
    }

    const scale = Math.max(1, Math.min(Math.ceil(costumeScale), this.maxScale));

    if (this.currentScale < scale) {
      this.currentScale = scale;
      this.OnRequestSize = true;
      this.render();
    }

  };

  VectorCostume.prototype.getContext = function() {

    if (this.ctx) {
      return this.ctx;
    }

    this.render();
    return this.ctx;

  };

  VectorCostume.prototype.getImage = function() {

    if (VectorCostume.DISABLE_RASTERIZE) {
      return this.svg;
    }

    if (this.canvas) {
      return this.canvas;
    }

    this.render();
    return this.canvas;

  };

  VectorCostume.prototype.destroy = function() {

    if (VectorCostume.DISABLE_RASTERIZE) {
      this.svg.remove();
    }

    if (this.canvas) {
      this.canvas.remove();
    }

  }

  VectorCostume.MAX_SCALE = 16;
  VectorCostume.MAX_SIZE = 2048;
  VectorCostume.DISABLE_RASTERIZE = false;

  var Sound = function(data) {

    this.source = null;
    this.name = data.name;
    this.buffer = data.buffer;
    this.duration = data.duration;

  }

  Sound.prototype.createSourceNode = function() {

    if (this.source) {
      this.source.disconnect();
    }

    const source = P.audioContext.createBufferSource();
    this.source = source;
    this.source.buffer = this.buffer;

    this.source.addEventListener('ended', () => {
      source.ended = true;
    });

    this.source.start();
    return this.source;
  };

  var Watcher = function(stage, targetName) {

    this.valid = true;
    this.visible = true;
    this.x = 0;
    this.y = 0;
    this.stage = stage;
    this.targetName = targetName;

  }

  Watcher.prototype.init = function () {
    this.target = this.stage.getObject(this.targetName) || this.stage;
  }

  Watcher.prototype.setVisible = function (visible) {
    this.visible = visible;
  }
  var Procedure = function(fn, warp, inputs) {
    this.fn = fn;
    if (typeof warp == 'string') {
      if (warp == 'true') {
        this.warp = true;
      } else {
        this.warp = false;
      }
    } else {
      this.warp = warp;
    }
    this.inputs = inputs;
  }

  var sb2 = {};

  sb2.ASSETS_API = 'https://assets.scratch.mit.edu/internalapi/asset/$md5ext/get';

  sb2.Scratch2Procedure = function (fn, warp, inputs) {
    Procedure.call(this, fn, warp, inputs);
  }

  inherits(sb2.Scratch2Procedure,Procedure);

  sb2.Scratch2Procedure.prototype.call = function (inputs) {
    return inputs;
  }

  sb2.Scratch2VariableWatcher = function (stage, targetName, data){

    Watcher.call(this,stage,targetName)
    this.cmd = data.cmd;
    this.type = data.type || 'var';
    if (data.color) {
      var c = (data.color < 0 ? data.color + 0x1000000 : data.color).toString(16);
      this.color = '#000000'.slice(0, -c.length) + c;
    }
    else {
      this.color = '#ee7d16';
    }
    this.isDiscrete = data.isDiscrete == null ? true : data.isDiscrete;
    this.label = data.label || '';
    this.mode = data.mode || 1;
    this.param = data.param;
    this.sliderMax = data.sliderMax == null ? 100 : data.sliderMax;
    this.sliderMin = data.sliderMin || 0;
    this.targetName = data.target;
    this.visible = data.visible == null ? false : data.visible;
    this.x = data.x || 0;
    this.y = data.y || 0;

  }

  inherits(sb2.Scratch2VariableWatcher,Watcher);

  sb2.Scratch2VariableWatcher.prototype.init = function() {

    Watcher.prototype.init.call(this);
    if (this.target && this.cmd === 'getVar:') {
      this.target.watchers[this.param] = this;
    }

    if (!this.label) {
      this.label = this.getLabel();
      if (this.target.isSprite)
        this.label = this.target.name + ': ' + this.label;
    }
    this.layout();

  }

  sb2.Scratch2VariableWatcher.prototype.getLabel = function() {

    var WATCHER_LABELS = {

      'costumeIndex': 'costume #',

      'xpos': 'x position',

      'ypos': 'y position',

      'heading': 'direction',

      'scale': 'size',

      'backgroundIndex': 'background #',

      'sceneName': 'background name',

      'tempo': 'tempo',

      'volume': 'volume',

      'answer': 'answer',

      'timer': 'timer',

      'soundLevel': 'loudness',

      'isLoud': 'loud?',

      'xScroll': 'x scroll',

      'yScroll': 'y scroll'

    };

    switch (this.cmd) {

      case 'getVar:': return this.param;
      case 'sensor:': return this.param + ' sensor value';
      case 'sensorPressed': return 'sensor ' + this.param + '?';
      case 'timeAndDate': return this.param;
      case 'senseVideoMotion': return 'video ' + this.param;

    }

    return WATCHER_LABELS[this.cmd] || '';

  }

  sb2.Scratch2VariableWatcher.prototype.setVisible = function(visible) {

    Watcher.prototype.setVisible.call(this, visible)
    this.layout();

  }

  sb2.Scratch2VariableWatcher.prototype.update = function() {

    var value = 0;
    if (!this.target)
      return;
    switch (this.cmd) {
      case 'answer':
        value = this.stage.answer;
        break;
      case 'backgroundIndex':
        value = this.stage.currentCostumeIndex + 1;
        break;
      case 'costumeIndex':
        value = this.target.currentCostumeIndex + 1;
        break;
      case 'getVar:':
        value = this.target.vars[this.param] == undefined ? ('unknown var: ' + this.param) : this.target.vars[this.param];
        break;
      case 'heading':
        value = this.target.direction;
        break;
      case 'scale':
        if (this.target.isSprite) {
          value = this.target.scale * 100;
        }
        break;
      case 'sceneName':
        value = this.stage.getCostumeName();
        break;
      case 'senseVideoMotion':
        break;
      case 'soundLevel':
        if (this.stage.microphone) {
          value = this.stage.microphone.getLoudness();
        }
        else {
          value = -1;
        }
        break;
      case 'tempo':
        value = this.stage.tempoBPM;
        break;
      case 'timeAndDate':
        value = this.timeAndDate(this.param);
        break;
      case 'timer':
        value = Math.round((this.stage.now() - this.stage.timerStart) / 100) / 10;
        break;
      case 'volume':
        value = this.target.volume * 100;
        break;
      case 'xpos':
        value = this.target.scratchX;
        break;
      case 'ypos':
        value = this.target.scratchY;
        break;
    }

    if (typeof value === 'number' && (value < 0.001 || value > 0.001)) {
      value = Math.round(value * 1000) / 1000;
    }

    this.readout.textContent = '' + value;
    if (this.slider) {
      this.buttonWrap.style.transform = 'translate(' + ((+value || 0) - this.sliderMin) / (this.sliderMax - this.sliderMin) * 100 + '%,0)';
    }

  }

  sb2.Scratch2VariableWatcher.prototype.timeAndDate = function(format) {

    switch (format) {

      case 'year':

        return new Date().getFullYear();

      case 'month':

        return new Date().getMonth() + 1;

      case 'date':

        return new Date().getDate();

      case 'day of week':

        return new Date().getDay() + 1;

      case 'hour':

        return new Date().getHours();

      case 'minute':

        return new Date().getMinutes();

      case 'second':

        return new Date().getSeconds();

    }

    return 0;

  }

  sb2.Scratch2VariableWatcher.prototype.layout = function() {

    if (this.el) {
      this.el.style.display = this.visible ? 'block' : 'none';
      return;
    }

    if (!this.visible)
      return;

    this.el = document.createElement('div');
    this.el.dataset.watcher = '' + this.stage.allWatchers.indexOf(this);
    this.el.style.whiteSpace = 'pre';
    this.el.style.position = 'absolute';
    this.el.style.left = this.el.style.top = '0';
    this.el.style.transform = 'translate(' + (this.x | 0) / 10 + 'em,' + (this.y | 0) / 10 + 'em)';
    this.el.style.cursor = 'default';

    if (this.mode === 2) {
      this.el.appendChild(this.readout = document.createElement('div'));
      this.readout.style.minWidth = (38 / 15) + 'em';
      this.readout.style.font = 'bold 1.5em/' + (19 / 15) + ' sans-serif';
      this.readout.style.height = (19 / 15) + 'em';
      this.readout.style.borderRadius = (4 / 15) + 'em';
      this.readout.style.margin = (3 / 15) + 'em 0 0 0';
      this.readout.style.padding = '0 ' + (3 / 10) + 'em';
    } else {
      this.el.appendChild(this.labelEl = document.createElement('div'));
      this.el.appendChild(this.readout = document.createElement('div'));
      this.el.style.border = '.1em solid rgb(148,145,145)';
      this.el.style.borderRadius = '.4em';
      this.el.style.background = 'rgb(193,196,199)';
      this.el.style.padding = '.2em .6em .3em .5em';
      this.labelEl.textContent = this.label;
      this.labelEl.style.font = 'bold 1.1em/1 sans-serif';
      this.labelEl.style.display = 'inline-block';
      this.labelEl.style.verticalAlign =
      this.readout.style.verticalAlign = 'middle';
      this.readout.style.minWidth = (37 / 10) + 'em';
      this.readout.style.padding = '0 ' + (1 / 10) + 'em';
      this.readout.style.font = 'bold 1.0em/' + (13 / 10) + ' sans-serif';
      this.readout.style.height = (13 / 10) + 'em';
      this.readout.style.borderRadius = (4 / 10) + 'em';
      this.readout.style.marginLeft = (6 / 10) + 'em';
    }

    this.readout.style.color = '#fff';
    var f = 1 / (this.mode === 2 ? 15 : 10);
    this.readout.style.border = f + 'em solid #fff';
    this.readout.style.boxShadow = 'inset ' + f + 'em ' + f + 'em ' + f + 'em rgba(0,0,0,.5), inset -' + f + 'em -' + f + 'em ' + f + 'em rgba(255,255,255,.5)';
    this.readout.style.textAlign = 'center';
    this.readout.style.background = this.color;
    this.readout.style.display = 'inline-block';

    if (this.mode === 3) {

      this.el.appendChild(this.slider = document.createElement('div'));
      this.slider.appendChild(this.buttonWrap = document.createElement('div'));
      this.buttonWrap.appendChild(this.button = document.createElement('div'));

      this.slider.style.height =
        this.slider.style.borderRadius = '.5em';
      this.slider.style.background = 'rgb(192,192,192)';
      this.slider.style.margin = '.4em 0 .1em';
      this.slider.style.boxShadow = 'inset .125em .125em .125em rgba(0,0,0,.5), inset -.125em -.125em .125em rgba(255,255,255,.5)';
      this.slider.style.position = 'relative';
      this.slider.style.pointerEvents = 'auto';
      this.slider.dataset.slider = '';
      this.slider.style.paddingRight =
        this.button.style.width =
          this.button.style.height =
            this.button.style.borderRadius = '1.1em';
      this.button.style.position = 'absolute';
      this.button.style.left = '0';
      this.button.style.top = '-.3em';
      this.button.style.background = '#fff';
      this.button.style.boxShadow = 'inset .3em .3em .2em -.2em rgba(255,255,255,.9), inset -.3em -.3em .2em -.2em rgba(0,0,0,.9), inset 0 0 0 .1em #777';
      this.button.dataset.button = '';
    }
    this.stage.ui.appendChild(this.el);
  }

  sb2.parseSVG = function (source, costumeOptions) {

    function patchSVG(svg, element) {

      const FONTS = {
        'Scratch': 'Scratch',
        'Helvetica': 'Helvetica',
        Donegal: 'Donegal One',
        Gloria: 'Gloria Hallelujah',
        Marker: 'Permanent Marker',
        Mystery: 'Mystery Quest'
      };

      const fontBBox = {
        'Donegal One': {sx: 0.09, sy: 1.07},
        'Gloria Hallelujah': {sx: 0.09, sy: 1.5},
        'Helvetica': {sx: 0.09, sy: 1},
        'Permanent Marker': {sx: 0.09, sy: 1.2},
        'Mystery Quest': {sx: 0.105, sy: 1.055},
        'Scratch': {sx: 0.1, sy: 0.79}
      };

      const LINE_HEIGHTS = {
        Helvetica: 1.13,
        'Scratch': 0.88,
        'Donegal One': 1.25,
        'Gloria Hallelujah': 1.97,
        'Permanent Marker': 1.43,
        'Mystery Quest': 1.37
      };

      if (element.nodeType !== 1)
        return;

      if (element.nodeName === 'svg') {

        var defs = document.createElement('defs');
        svg.appendChild(defs);
        var style = document.createElement('style');
        defs.appendChild(style);
        var embedText = '';

        if (element.querySelector('[font-family="Scratch"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: Scratch;\nsrc: url(\"data:application/x-font-ttf;base64,';
          embedText += ScratchFonts.sb2.Scratch;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (element.querySelector('[font-family="Donegal"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: Donegal One;\nsrc: url(\"data:application/x-font-ttf;base64,';
          embedText += ScratchFonts.sb2.Donegal;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (element.querySelector('[font-family="Gloria"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: Gloria Hallelujah;\nsrc: url(\"data:application/x-font-ttf;base64,';
          embedText += ScratchFonts.sb2.Gloria;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (element.querySelector('[font-family="Helvetica"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: Helvetica;\nsrc: url(\"data:application/x-font-ttf;base64,';
          embedText += ScratchFonts.sb2.Helvetica;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (element.querySelector('[font-family="Marker"]')) {
          embedText += '@font-face{\n';
          embedText += 'font-family: Permanent Marker;\nsrc: url(\"data:application/x-font-ttf;base64,';
          embedText += ScratchFonts.sb2.Marker;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (element.querySelector('[font-family="Mystery"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: Mystery Quest;\nsrc: url(\"data:application/x-font-ttf;base64,';
          embedText += ScratchFonts.sb2.Mystery;
          embedText += '\");\n';
          embedText += '}\n';

        }

        var info = document.createTextNode(embedText);
        style.appendChild(info);
      }

      if (element.nodeName === 'text') {

        var font = element.getAttribute('font-family') || '';
        font = FONTS[font] || font;
        element.setAttribute('font-family', font);

        var size = +element.getAttribute('font-size');
        if (!size) {
          element.setAttribute('font-size', size = 18);
        }

        if (element.getAttribute('fill') === 'none')
          element.setAttribute('fill', '#7F7F7F');

        var x = size * (!!fontBBox[font] ? (fontBBox[font].sx || 0) : 0);
        var y = size * (!!fontBBox[font] ? (fontBBox[font].sy || 0) : 0);

        element.setAttribute('x', x);
        element.setAttribute('y', y);

        var lines = element.textContent.split('\n');

        if (lines.length > 1) {

          element.textContent = lines[0];
          var lineHeight = LINE_HEIGHTS[font] || 1;

          for (var i = 1, l = lines.length; i < l; i++) {

            var tspan = document.createElementNS("http://www.w3.org/2000/svg", 'tspan');
            tspan.textContent = lines[i];
            tspan.setAttribute('x', x);
            tspan.setAttribute('y', y + size * i * lineHeight);
            element.appendChild(tspan);

          }

        }

      } else if ((element.hasAttribute('x') || element.hasAttribute('y')) && element.hasAttribute('transform')) {
        
        element.setAttribute('x', 0);
        element.setAttribute('y', 0);

      }
      
      [].forEach.call(element.childNodes, patchSVG.bind(null, svg));

    };

    const parser = new DOMParser();
    var doc = parser.parseFromString(source, 'image/svg+xml');
    var svg = doc.documentElement;

    if (!svg.style) {

      doc = parser.parseFromString('<body>' + source, 'text/html');
      svg = doc.querySelector('svg');

    }

    DOMPurify.sanitize(svg, {
      IN_PLACE: true,
      USE_PROFILES: { svg: true }
    });

    svg.style.visibility = 'hidden';
    svg.style.position = 'absolute';
    svg.style.left = '-10000px';
    svg.style.top = '-10000px';
    svg.style['image-rendering'] = '-moz-crisp-edges';
    svg.style['image-rendering'] = 'pixelated';

    document.body.appendChild(svg);
    patchSVG(svg, svg);

    var viewBox = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : { width: 0, height: 0, x: 0, y: 0 };

    if (viewBox && (viewBox.x || viewBox.y)) {

      var bb = svg.getBBox();
      viewBox.width = svg.width.baseVal.value = Math.ceil(bb.width);
      viewBox.height = svg.height.baseVal.value = Math.ceil(bb.height);
      viewBox.x = bb.x;
      viewBox.y = bb.y;
      costumeOptions.rotationCenterX += -bb.x;
      costumeOptions.rotationCenterY += -bb.y;

    }
    
    document.body.removeChild(svg);
    svg.style.visibility = svg.style.position = svg.style.left = svg.style.top = '';
    var newSource = (new XMLSerializer()).serializeToString(svg)
    return 'data:image/svg+xml,' + encodeURIComponent(newSource);

  }

  sb2.Scratch2Stage = function() {
    Stage.call(this);
    this.dragging = {};
    this.defaultWatcherX = 10;
    this.defaultWatcherY = 10;
  }

  inherits(sb2.Scratch2Stage,Stage);

  sb2.Scratch2Stage.prototype.createVariableWatcher = function (target, variableName) {

    const x = this.defaultWatcherX;
    const y = this.defaultWatcherY;
    this.defaultWatcherY += 26;

    if (this.defaultWatcherY >= 450) {
      this.defaultWatcherY = 10;
      this.defaultWatcherX += 150;
    }

    return new P.sb2.Scratch2VariableWatcher(this, target.name, {cmd: 'getVar:', param: variableName, x, y});
  }

  sb2.Scratch2Stage.prototype.say = function(text, thinking) {
    return ++this.sayId;
  }

  sb2.Scratch2Stage.prototype.updateBubble = function() {}

  sb2.Scratch2Stage.prototype.watcherStart = function(id, t, e) {

    var p = e.target;
    while (p && p.dataset.watcher == null)
      p = p.parentElement;
    if (!p)
      return;
    var w = this.allWatchers[p.dataset.watcher];
    this.dragging[id] = {
      watcher: w,
      offset: (e.target.dataset.button == null ? -w.button.offsetWidth / 2 | 0 : w.button.getBoundingClientRect().left - t.clientX) - w.slider.getBoundingClientRect().left
    };

  }

  sb2.Scratch2Stage.prototype.watcherMove = function(id, t, e) {

    var d = this.dragging[id];
    if (!d)
      return;
    var w = d.watcher;

    var sw = w.slider.offsetWidth;
    var bw = w.button.offsetWidth;

    var value = w.sliderMin + Math.max(0, Math.min(1, (t.clientX + d.offset) / (sw - bw))) * (w.sliderMax - w.sliderMin);
    w.target.vars[w.param] = w.isDiscrete ? Math.round(value) : Math.round(value * 100) / 100;
    w.update();
    e.preventDefault();

  }

  sb2.Scratch2Stage.prototype.watcherEnd = function(id, t, e) {

    this.watcherMove(id, t, e);
    delete this.dragging[id];

  }

  sb2.Scratch2Stage.prototype.ontouch = function(event, touch) {

    const target = event.target;
    if (target.dataset.button != null || target.dataset.slider != null) {
      this.watcherStart(touch.identifier, touch, event);
    }

  }

  sb2.Scratch2Stage.prototype.onmousedown = function(e) {

    const target = e.target;
    if (target.dataset.button != null || target.dataset.slider != null) {
      this.watcherStart('mouse', e, e);
    }

  }

  sb2.Scratch2Stage.prototype.onmousemove = function(e) {
    this.watcherMove('mouse', e, e);
  }

  sb2.Scratch2Stage.prototype.onmouseup = function(e) {
    this.watcherEnd('mouse', e, e);
  }

  sb2.BaseSB2Loader = function (projectData) {

    IO.Loader.call(this);
    this.projectData = projectData;

  }

  inherits(sb2.BaseSB2Loader,IO.Loader);

  sb2.BaseSB2Loader.prototype.loadBase = function (data, isStage) {

    var costumes;
    var sounds;

    return Promise.all([

      this.loadArray(data.costumes, this.loadCostume.bind(this)).then((c) => costumes = c),
      this.loadArray(data.sounds, this.loadSound.bind(this)).then((s) => sounds = s),

    ]).then(() => {

      const object = new (isStage ? sb2.Scratch2Stage : Sprite)(null);
      if (data.variables) {
        for (const variable of data.variables) {
          if (variable.isPersistent) {
            if (object.isStage) {
              object.cloudVariables.push(variable.name);
            } else {
              console.warn('Cloud variable found on a non-stage object. Skipping.');
            }
          }
          object.vars[variable.name] = variable.value;
        }
      }

      if (data.lists) {
        for (const list of data.lists) {
          if (list.isPersistent) {
            console.warn('Cloud lists are not supported');
          }
          object.lists[list.listName] = list.contents;
        }
      }

      object.name = data.objName;
      object.costumes = costumes;
      object.currentCostumeIndex = Math.floor(data.currentCostumeIndex);
      sounds.forEach((sound) => sound && object.addSound(sound));

      if (isStage) {

        object.videoTransparency = data.videoAlpha;

      } else {

        const sprite = object;
        sprite.scratchX = data.scratchX;
        sprite.scratchY = data.scratchY;
        sprite.direction = data.direction;
        sprite.isDraggable = data.isDraggable;
        sprite.rotationStyle = P.utils.parseRotationStyle(data.rotationStyle);
        sprite.scale = data.scale;
        sprite.visible = data.visible;

      }

      object.scripts = data.scripts || [];
      return object;

    })

  }

  sb2.BaseSB2Loader.prototype.loadArray = function (data, process) {
    return Promise.all((data || []).map((i, ind) => process(i, ind)));
  }

  sb2.BaseSB2Loader.prototype.loadObject = function (data) {

    if (data.cmd) {
      return this.loadVariableWatcher(data);
    } else if (data.listName) {} else {
      return this.loadBase(data, false);
    }

  }

  sb2.BaseSB2Loader.prototype.loadVariableWatcher = function (data) {

    const targetName = data.target;
    const watcher = new sb2.Scratch2VariableWatcher(null, targetName, data);
    return watcher;

  }

  sb2.BaseSB2Loader.prototype.loadCostume = function (data) {

    const promises = [
      this.loadMD5(data.baseLayerMD5, data.baseLayerID, false, data)
        .then((asset) => data.$image = asset)
    ];

    if (data.textLayerMD5) {
      promises.push(this.loadMD5(data.textLayerMD5, data.textLayerID, false, data)
        .then((asset) => data.$text = asset));
    }

    return Promise.all(promises)
      .then((layers) => {
      var image;
      if (layers.length > 1) {
        image = document.createElement('canvas');
        const ctx = image.getContext('2d');
        if (!ctx) {
            throw new Error('Cannot get 2d rendering context loading costume ' + data.costumeName);
        }

        image.width = Math.max(layers[0].width, 1);
        image.height = Math.max(layers[0].height, 1);

        for (const layer of layers) {
          ctx.drawImage(layer, 0, 0);
        }
      } else {
        image = layers[0];
      }
      if (layers[0].src.slice(0, 18) == 'data:image/svg+xml') {
        return new VectorCostume(image, {

          name: data.costumeName,
          bitmapResolution: data.bitmapResolution,
          rotationCenterX: data.rotationCenterX,
          rotationCenterY: data.rotationCenterY,

        });
      } else {
        return new BitmapCostume(image, {

          name: data.costumeName,
          bitmapResolution: data.bitmapResolution,
          rotationCenterX: data.rotationCenterX,
          rotationCenterY: data.rotationCenterY,

        });
      }
    });
  }

  sb2.BaseSB2Loader.prototype.loadSound = function (data) {

    return new Promise((resolve, reject) => {
      this.loadMD5(data.md5, data.soundID, true, data)
        .then((buffer) => {
        resolve(new Sound({

          name: data.soundName,
          duration: data.sampleCount / data.rate,
          buffer,

        }));
      })
        .catch((err) => {
        resolve(null);
        console.warn('Could not load sound: ' + err);
      });
    });
  }

  sb2.BaseSB2Loader.prototype.loadSVG = function (source, target) {

    var imgURL = sb2.parseSVG(source, target);
    return new Promise(async (resolve) => {
      resolve(await IO.loadImage(imgURL));
    }).then((img) => {
      return img;
    })

  }

  sb2.BaseSB2Loader.prototype.loadImage = function (url) {

    return new Promise(async (resolve) => {
      try {

        var req = await this.addTask(new P.IO.Request(url)).load('blob');
        var img = await P.IO.loadImage(await P.IO.reader(req, 'dataurl'));

        resolve(img);

      } catch (error) {

        console.warn('Could not load image: ' + error);

        var img = await IO.loadDotImage();
        resolve(img);

      }
      
    });

  }

  sb2.BaseSB2Loader.prototype.load = function () {

    var children;
    var stage;

    return Promise.all([

      this.loadArray(this.projectData.children, this.loadObject.bind(this)).then((c) => children = c),
      this.loadBase(this.projectData, true).then((s) => stage = s),

    ]).then(() => {

      children = children.filter((i) => i);
      children.forEach((c) => c.stage = stage);
      const sprites = children.filter((i) => i instanceof Sprite);
      const watchers = children.filter((i) => i instanceof sb2.Scratch2VariableWatcher);
      stage.children = sprites;
      stage.allWatchers = watchers;
      stage.allWatchers.forEach((w) => w.init());
      stage.isSb3 = false;
      P.sb2.compiler.compile(stage);
      return stage;

    })
  }

  sb2.Scratch2Loader = function (idOrData) {

    sb2.BaseSB2Loader.call(this)
    if (typeof idOrData === 'object') {
      this.projectData = idOrData;
      this.projectId = null;
    }else {
      this.projectId = idOrData;
    }

  }

  inherits(sb2.Scratch2Loader,sb2.BaseSB2Loader);

  sb2.Scratch2Loader.prototype.loadMD5 = function (hash, id, isAudio = false, target) {

    const hash2 = P.IO.md5NullS(hash, isAudio);
    const ext = hash2.split('.').pop();

    if (ext === 'svg') {
      return this.addTask(new P.IO.Request(sb2.ASSETS_API.replace('$md5ext', hash2))).load('text')
          .then((text) => this.loadSVG(text, target));
    } else if (ext === 'wav') {
      return this.addTask(new P.IO.Request(sb2.ASSETS_API.replace('$md5ext', hash2))).load('arraybuffer')
        .then((buffer) => P.IO.decodeAudio(buffer));
    } else {
      return this.loadImage(sb2.ASSETS_API.replace('$md5ext', hash2));
    }

  }

  sb2.Scratch2Loader.prototype.load = function () {
    return sb2.BaseSB2Loader.prototype.load.call(this);
  }

  sb2.SB2FileLoader = function (buffer) {

    sb2.BaseSB2Loader.call(this)
    this.buffer = buffer;

  }

  inherits(sb2.SB2FileLoader,sb2.BaseSB2Loader);

  sb2.SB2FileLoader.prototype.loadMD5 = function (hash, id, isAudio = false, target) {

    const f = isAudio ? (this.zip.file(id + '.wav') || this.zip.file(id + '.mp3')) : this.zip.file(id + '.gif') || (this.zip.file(id + '.png') || this.zip.file(id + '.jpg') || this.zip.file(id + '.svg'));
    
    if (!f) {
      if (isAudio) {
        return f.async('arraybuffer')
          .then((buffer) => P.IO.decodeAudio(buffer));
      } else {
        return IO.loadImage('data:image/png;base64,');
      }
    }

    hash = f.name;

    if (isAudio) {
      return f.async('arraybuffer')
        .then((buffer) => P.IO.decodeAudio(buffer));
    }

    const ext = hash.split('.').pop();

    if (ext === 'svg') {

      return f.async('text')
        .then((text) => this.loadSVG(text, target));

    } else {

      return new Promise((resolve, reject) => {

        var image = new Image();
        image.onload = function () {
          resolve(image);
        };
        image.onerror = function () {
          reject(new Error('Failed to load image: ' + hash + '/' + id));
        };

        f.async('binarystring')
          .then((data) => {
            image.src = 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + btoa(data);
        });

      });

    }
  }

  sb2.SB2FileLoader.prototype.load = function () {

    return JSZip.loadAsync(this.buffer)
      .then((data) => {
      this.zip = data;
      const project = this.zip.file('project.json');
      if (!project) {
        throw new Error('project.json is missing');
      }
      return project.async('text');
    })
      .then((project) => {

      this.projectData = P.IO.parseJSONish(project);

    })
      .then(() => sb2.BaseSB2Loader.prototype.load.call(this));
  }

  var sb3 = {}

  sb3.ASSETS_API = 'https://assets.scratch.mit.edu/internalapi/asset/$md5ext/get/';

  sb3.Scratch3Procedure = function (fn, warp, inputs) {
    Procedure.call(this,fn, warp, inputs);
  }

  inherits(sb3.Scratch3Procedure,Procedure);

  sb3.Scratch3Procedure.prototype.call = function (inputs) {

    const args = {};
    for (var i = 0; i < this.inputs.length; i++) {
      args[this.inputs[i]] = inputs[i];
    }
    return args;

  }

  sb3.Scratch3VariableWatcher = function (stage, data){

    Watcher.call(this,stage, data.spriteName || '')

    this.id = data.id;
    this.opcode = data.opcode;
    this.mode = data.mode;
    this.params = data.params;
    this.libraryEntry = P.sb3.compiler.watcherLibrary[this.opcode];
    this.x = data.x;
    this.y = data.y;
    this.visible = typeof data.visible === 'boolean' ? data.visible : true;
    this.sliderMin = data.sliderMin || 0;
    this.sliderMax = data.sliderMax || 0;

    if (typeof data.isDiscrete !== 'undefined') {
      this.sliderStep = data.isDiscrete ? 1 : 0.01;
    } else {
      this.sliderStep = 1;
    }
    if (!this.libraryEntry) {
      console.warn('unknown watcher', this.opcode, this);
      this.valid = false;
    }

  }

  inherits(sb3.Scratch3VariableWatcher,Watcher);

  sb3.Scratch3VariableWatcher.prototype.update = function() {

    if (this.visible) {
      const value = this.getValue();
      if (this.valueEl.textContent !== value) {
        this.valueEl.textContent = value;
      }
      if (this.sliderInput) {
        this.sliderInput.value = value;
      }
    }

  }

  sb3.Scratch3VariableWatcher.prototype.init = function() {

    Watcher.prototype.init.call(this);
    if (this.libraryEntry.init) {
      this.libraryEntry.init(this);
    }
    this.updateLayout();

  }

  sb3.Scratch3VariableWatcher.prototype.setVisible = function(visible) {

    Watcher.prototype.setVisible.call(this, visible);
    this.updateLayout();

  }

  sb3.Scratch3VariableWatcher.prototype.getLabel = function() {

    const label = this.libraryEntry.getLabel(this);

    if (!this.target.isStage) {

      return this.targetName + ': ' + label;
      
    }

    return label;

  }

  sb3.Scratch3VariableWatcher.prototype.update = function() {

    if (this.visible) {
      const value = this.getValue();
      if (this.valueEl.textContent !== value) {
        this.valueEl.textContent = value;
      }
      if (this.sliderInput) {
        this.sliderInput.value = value;
      }
    }

  }

  sb3.Scratch3VariableWatcher.prototype.getValue = function() {

    const value = this.libraryEntry.evaluate(this);
    if (typeof value === 'number') {
      return '' + (Math.round(value * 1e6) / 1e6);
    }
    return '' + value;

  }

  sb3.Scratch3VariableWatcher.prototype.setValue = function(value) {
    if (this.libraryEntry.set) {
      this.libraryEntry.set(this, value);
      this.update();
    }
  }

  sb3.Scratch3VariableWatcher.prototype.updateLayout = function() {

    if (this.containerEl) {
      this.containerEl.style.display = this.visible ? 'flex' : 'none';
      return;
    }

    if (!this.visible) {
      return;
    }

    const container = document.createElement('div');

    container.classList.add('s3-watcher-container');
    container.dataset.opcode = this.opcode;
    container.style.top = (this.y / 10) + 'em';
    container.style.left = (this.x / 10) + 'em';
    container.onmousedown = (e) => e.stopPropagation();
    container.ontouchstart = (e) => e.stopPropagation();

    const value = document.createElement('div');
    value.classList.add('s3-watcher-value');
    value.textContent = this.getValue();
    this.containerEl = container;
    this.valueEl = value;
    this.stage.ui.appendChild(container);
    const mode = this.mode;

    if (mode === 'large') {

      container.classList.add('s3-watcher-large');
      container.appendChild(value);

    } else {

      const row = document.createElement('div');
      row.classList.add('s3-watcher-row');
      row.classList.add('s3-watcher-row-normal');
      const label = document.createElement('div');
      label.classList.add('s3-watcher-label');
      label.textContent = this.getLabel();
      row.appendChild(label);
      row.appendChild(value);
      container.classList.add('s3-watcher-container-normal');
      container.appendChild(row);

      if (mode === 'slider') {
        const slider = document.createElement('div');
        slider.classList.add('s3-watcher-row-slider');
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '' + this.sliderMin;
        input.max = '' + this.sliderMax;
        input.step = '' + this.sliderStep;
        input.value = this.getValue();
        input.addEventListener('input', this.sliderChanged.bind(this));
        this.sliderInput = input;
        slider.appendChild(input);
        container.appendChild(slider);
      }

    }

  }

  sb3.Scratch3VariableWatcher.prototype.sliderChanged = function(e) {

    const value = +e.target.value;
    this.setValue(value);

  }

  sb3.ListWatcherRow = function(e) {

    this.value = '';
    this.index = -1; 
    this.y = 0;
    this.visible = true;
    this.element = document.createElement('div');
    this.indexEl = document.createElement('div');
    this.valueEl = document.createElement('div');
    this.element.className = 's3-list-row';
    this.indexEl.className = 's3-list-index';
    this.valueEl.className = 's3-list-value';

    this.element.appendChild(this.indexEl);
    this.element.appendChild(this.valueEl);

  }

  sb3.ListWatcherRow.prototype.setValue = function(value) {
    if (value !== this.value) {
      this.value = value;
      this.valueEl.textContent = value;
    }
  }

  sb3.ListWatcherRow.prototype.setIndex = function(index) {
    if (index !== this.index) {
      this.index = index;
      this.indexEl.textContent = (index + 1).toString();
    }
  }

  sb3.ListWatcherRow.prototype.setY = function(y) {
    if (y !== this.y) {
      this.y = y;
      this.element.style.transform = 'translateY(' + y + 'px)';
    }
  }

  sb3.ListWatcherRow.prototype.setVisible = function(visible) {
    if (this.visible !== visible) {
      this.visible = visible;
      this.element.style.display = visible ? '' : 'none';
    }
  }

  sb3.Scratch3ListWatcher = function (stage, data){

    Watcher.call(this,stage, data.spriteName || '')
    this.rows = [];
    this.firstUpdateComplete = false;
    this._rowHeight = -1;
    this.scrollTop = 0;
    this.lastZoomLevel = 1;
    this.scrollAhead = 8;
    this.scrollBack = 3;
    this.scrollDirection = 1;
    this._contentHeight = -1;
    this.id = data.id;
    this.params = data.params;
    this.x = data.x;
    this.y = data.y;
    this.visible = typeof data.visible === 'boolean' ? data.visible : true;
    this.width = data.width || 100;
    this.height = data.height || 200;

  }

  inherits(sb3.Scratch3ListWatcher,Watcher);

  sb3.Scratch3ListWatcher.prototype.shouldUpdate = function() {

    if (!this.visible)
      return false;
    if (this.lastZoomLevel !== this.stage.zoom)
      return true;
    if (!this.firstUpdateComplete)
      return true;
    return this.list.modified;

  }

  sb3.Scratch3ListWatcher.prototype.update = function() {

    if (!this.shouldUpdate()) {
      return;
    }

    if (this.lastZoomLevel !== this.stage.zoom) {
      this.contentEl.scrollTop *= this.stage.zoom / this.lastZoomLevel;
    }

    this.list.modified = false;
    this.lastZoomLevel = this.stage.zoom;
    this.firstUpdateComplete = true;
    this.updateList();
    const bottomLabelText = this.getBottomLabel();
    if (this.bottomLabelEl.textContent !== bottomLabelText) {
      this.bottomLabelEl.textContent = this.getBottomLabel();
    }

  }

  sb3.Scratch3ListWatcher.prototype.updateList = function() {

    if (!this.visible && this._rowHeight === -1) {
      return;
    }

    const height = this.list.length * this.getRowHeight() * this.stage.zoom;
    this.endpointEl.style.transform = 'translateY(' + height + 'px)';
    const topVisible = this.scrollTop;
    const bottomVisible = topVisible + this.getContentHeight();
    let startingIndex = Math.floor(topVisible / this.getRowHeight());
    let endingIndex = Math.ceil(bottomVisible / this.getRowHeight());

    if (this.scrollDirection === 1) {
      startingIndex -= this.scrollBack;
      endingIndex += this.scrollAhead;
    } else {
      startingIndex -= this.scrollAhead;
      endingIndex += this.scrollBack;
    }

    if (startingIndex < 0)
      startingIndex = 0;
    if (endingIndex > this.list.length - 1)
      endingIndex = this.list.length - 1;
    if (endingIndex - startingIndex > 50) {
      endingIndex = startingIndex + 50;
    }

    const visibleRows = endingIndex - startingIndex;

    while (this.rows.length <= visibleRows) {
      this.addRow();
    }

    for (var listIndex = startingIndex, rowIndex = 0; listIndex <= endingIndex; listIndex++, rowIndex++) {
      let row = this.rows[rowIndex];
      row.setIndex(listIndex);
      row.setValue(this.list[listIndex]);
      row.setY(listIndex * this._rowHeight * this.stage.zoom);
      row.setVisible(true);
    }

    while (rowIndex < this.rows.length) {
      this.rows[rowIndex].setVisible(false);
      rowIndex++;
    }

  }

  sb3.createList = function() {

    const list = [];
    list.modified = false;
    list.toString = function () {

      var i = this.length;

      while (i--) {

        if (('' + this[i]).length !== 1) {

          return this.join(' ');

        }

      }

      return this.join('');

    };

    return list;

  }

  sb3.Scratch3ListWatcher.prototype.init = function() {

    Watcher.prototype.init.call(this);

    const target = this.target;
    const listId = this.id;
    const listName = target.listIds[listId];

    if (!(listName in this.target.lists)) {
      this.target.lists[listName] = sb3.createList();
    }

    this.list = this.target.lists[listName];
    this.target.listWatchers[listName] = this;
    if (this.visible) {
      this.updateLayout();
    }

  }

  sb3.Scratch3ListWatcher.prototype.getTopLabel = function() {

    if (this.target.isStage) {

      return this.params.LIST;

    }

    return this.target.name + ': ' + this.params.LIST;

  }

  sb3.Scratch3ListWatcher.prototype.getBottomLabel = function() {

    return 'length ' + this.list.length;

  }

  sb3.Scratch3ListWatcher.prototype.getContentHeight = function() {

    if (this._contentHeight === -1) {
      this._contentHeight = this.contentEl.offsetHeight;
    }

    return this._contentHeight;

  }

  sb3.Scratch3ListWatcher.prototype.getRowHeight = function() {

    if (this._rowHeight === -1) {
      const PADDING = 2;
      if (this.rows.length === 0) {
        this.addRow();
      }
      const height = this.rows[0].element.offsetHeight / this.stage.zoom;
      if (height === 0) {
        return 0;
      }
      this._rowHeight = height + PADDING;
    }
    return this._rowHeight;

  }

  sb3.Scratch3ListWatcher.prototype.addRow = function() {

    const row = new sb3.ListWatcherRow();
    this.rows.push(row);
    this.contentEl.appendChild(row.element);
    return row;

  }

  sb3.Scratch3ListWatcher.prototype.updateLayout = function() {

    if (!this.containerEl) {
      if (!this.visible) {
        return;
      }
      this.createLayout();
    }
    this.containerEl.style.display = this.visible ? '' : 'none';

  }

  sb3.Scratch3ListWatcher.prototype.setVisible = function(visible) {

    Watcher.prototype.setVisible.call(this, visible);
    this.updateLayout();

  }

  sb3.Scratch3ListWatcher.prototype.createLayout = function() {

    this.containerEl = document.createElement('div');
    this.topLabelEl = document.createElement('div');
    this.bottomLabelEl = document.createElement('div');
    this.middleContainerEl = document.createElement('div');
    this.contentEl = document.createElement('div');

    this.containerEl.style.top = (this.y / 10) + 'em';
    this.containerEl.style.left = (this.x / 10) + 'em';
    this.containerEl.style.height = (this.height / 10) + 'em';
    this.containerEl.style.width = (this.width / 10) + 'em';
    this.containerEl.classList.add('s3-list-container');
    this.containerEl.onmousedown = (e) => e.stopPropagation();
    this.containerEl.ontouchstart = (e) => e.stopPropagation();

    this.topLabelEl.textContent = this.getTopLabel();
    this.topLabelEl.classList.add('s3-list-top-label');
    this.bottomLabelEl.textContent = this.getBottomLabel();
    this.bottomLabelEl.classList.add('s3-list-bottom-label');
    this.middleContainerEl.classList.add('s3-list-content');
    this.contentEl.classList.add('s3-list-rows');

    this.contentEl.addEventListener('scroll', (e) => {
      const scrollTop = this.contentEl.scrollTop / this.stage.zoom;
      const scrollChange = this.scrollTop - scrollTop;
      if (scrollChange < 0) {
        this.scrollDirection = 1;
      } else if (scrollChange > 0) {
        this.scrollDirection = 0;
      }
      this.scrollTop = scrollTop;
      this.updateList();
    });

    this.endpointEl = document.createElement('div');
    this.endpointEl.className = 's3-list-endpoint';

    this.contentEl.appendChild(this.endpointEl);
    this.middleContainerEl.appendChild(this.contentEl);
    this.containerEl.appendChild(this.topLabelEl);
    this.containerEl.appendChild(this.middleContainerEl);
    this.containerEl.appendChild(this.bottomLabelEl);
    this.stage.ui.appendChild(this.containerEl);
  }

  sb3.parseSVG = function (source, costumeOptions) {

    var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

    function fixSVGNamespace(svg) {
      const newDocument = document.implementation.createHTMLDocument();
      const newSVG = newDocument.createElementNS(SVG_NAMESPACE, 'svg');
      for (const attribute of svg.attributes) {
        newSVG.setAttribute(attribute.name, attribute.value);
      }
      newSVG.innerHTML = svg.innerHTML;
      return newSVG;
    }

    var patchSVG = function (svg, costumeOptions) {

      if (!svg.style) {

        doc = parser.parseFromString('<body>' + source, 'text/html');
        svg = doc.querySelector('svg');
  
      }
  
      DOMPurify.sanitize(svg, {
        IN_PLACE: true,
        USE_PROFILES: { svg: true }
      });
  
      svg.style.position = 'absolute';

      if (svg.nodeType !== 1)
        return;
      if (svg.nodeName === 'svg') {

        var defs = document.createElement('defs');
        svg.appendChild(defs);
        var style = document.createElement('style');
        defs.appendChild(style);
        var embedText = '';

        if (svg.querySelector('[font-family="Sans Serif"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: "Sans Serif";\nsrc: url(\"data:application/x-font-woff;base64,';
          embedText += ScratchFonts.sb3.SansSerif;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (svg.querySelector('[font-family="Serif"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: "Serif";\nsrc: url(\"data:application/x-font-woff;base64,';
          embedText += ScratchFonts.sb3.Serif;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (svg.querySelector('[font-family="Handwriting"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: "Handwriting";\nsrc: url(\"data:application/x-font-woff;base64,';
          embedText += ScratchFonts.sb3.Handwriting;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (svg.querySelector('[font-family="Marker"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: "Marker";\nsrc: url(\"data:application/x-font-woff;base64,';
          embedText += ScratchFonts.sb3.Marker;
          embedText += '\");\n';
          embedText += '}\n';
        }

        if (svg.querySelector('[font-family="Curly"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: "Curly";\nsrc: url(\"data:application/x-font-woff;base64,';
          embedText += ScratchFonts.sb3.Curly;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (svg.querySelector('[font-family="Scratch"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: "Scratch";\nsrc: url(\"data:application/x-font-woff;base64,';
          embedText += ScratchFonts.sb2.Scratch;
          embedText += '\");\n';
          embedText += '}\n';

        }

        if (svg.querySelector('[font-family="Pixel"]')) {

          embedText += '@font-face{\n';
          embedText += 'font-family: "Pixel";\nsrc: url(\"data:application/x-font-woff;base64,';
          embedText += ScratchFonts.sb3.Pixel;
          embedText += '\");\n';
          embedText += '}\n';

        }

        var info = document.createTextNode(embedText);
        style.appendChild(info);

      }

      const invalidNamespace = svg.namespaceURI !== SVG_NAMESPACE;

      if (invalidNamespace) {

        svg = fixSVGNamespace(svg);
        if (svg.firstElementChild && svg.firstElementChild.tagName !== 'g') {

          const width = svg.width.baseVal;
          const height = svg.height.baseVal;

          if (width.unitType !== width.SVG_LENGTHTYPE_PERCENTAGE && height.unitType !== width.SVG_LENGTHTYPE_PERCENTAGE) {

            const group = document.createElementNS(SVG_NAMESPACE, 'g');
            const transform = svg.createSVGTransform();

            for (const el of svg.children) {
              group.appendChild(el);
            }

            transform.setTranslate(-width.value / 2, height.value / 2);
            group.transform.baseVal.appendItem(transform);

            costumeOptions.rotationCenterX -= width.value / 2;
            costumeOptions.rotationCenterY += height.value / 2;

            svg.appendChild(group);

          }

        }

      }
      
      if (svg.hasAttribute('viewBox')) {

        const viewBox = svg.getAttribute('viewBox').split(/ |,/).map((i) => +i);

        if (viewBox.every((i) => !isNaN(i)) && viewBox.length === 4) {
          const [x, y, w, h] = viewBox;
          const width = Math.max(1, w);
          const height = Math.max(1, h);
          svg.setAttribute('width', width.toString());
          svg.setAttribute('height', height.toString());
        }

        svg.removeAttribute('viewBox');

      }

      var viewBox = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : { width: 0, height: 0, x: 0, y: 0 };

      if (viewBox) {

        var bb = svg.getBBox();
        viewBox.width = svg.width.baseVal.value = Math.ceil(bb.width);
        viewBox.height = svg.height.baseVal.value = Math.ceil(bb.height);
        viewBox.x = bb.x;
        viewBox.y = bb.y;
        costumeOptions.rotationCenterX += -bb.x;
        costumeOptions.rotationCenterY += -bb.y;

      }

     

    }

    var parser = new DOMParser();
    var doc = parser.parseFromString(source, 'image/svg+xml');
    var svg = doc.documentElement;
    doc = parser.parseFromString('<body>' + source, 'text/html');
    svg = doc.querySelector('svg');

    

    if (svg) {

      document.body.appendChild(svg);

      patchSVG(svg, costumeOptions);

      svg.style['image-rendering'] = '-moz-crisp-edges';
      svg.style['image-rendering'] = 'pixelated';

      document.body.removeChild(svg);

    } else {

      svg = document.createElement('svg');

      svg.setAttribute('version', '1.1');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    }

    
    
    return 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));

  }

  sb3.BaseSB3Loader = function (projectData,isZip) {

    IO.Loader.call(this)
    this.projectData = projectData;
    this.isZip = isZip;

  }

  inherits(sb3.BaseSB3Loader,IO.Loader);

  sb3.BaseSB3Loader.prototype.getSVG = function (path, costumeOptions) {

    return this.getAsText(path)
      .then((source) => {
      const svg = sb3.parseSVG(source, costumeOptions);
      return IO.loadImage(svg);
    });

  }

  sb3.BaseSB3Loader.prototype.getBitmapImage = function (path, format) {

    return this.getAsImage(path, format);

  }

  sb3.BaseSB3Loader.prototype.loadCostume = function (data) {

    const path = data.assetId + '.' + data.dataFormat;

    const costumeOptions = {

      name: data.name,
      bitmapResolution: data.bitmapResolution || 1,
      rotationCenterX: data.rotationCenterX,
      rotationCenterY: data.rotationCenterY,

    };

    if (data.dataFormat === 'svg') {

      return this.getSVG(path, costumeOptions)
        .then((svg) => new VectorCostume(svg, costumeOptions));

    } else {

      return this.getBitmapImage(path, data.dataFormat)
        .then((image) => new BitmapCostume(image, costumeOptions));

    }

  }

  sb3.BaseSB3Loader.prototype.loadSound = function (data) {

    return new Promise((resolve, reject) => {
      this.getAudioBuffer(data.md5ext)
        .then((buffer) => {
        resolve(new Sound({

          name: data.name,
          duration: data.sampleCount / data.rate,
          buffer,

        }));
      })
        .catch((err) => {

        console.warn('Could not load sound: ' + err);
        resolve(null);

      });
    });
  }

  sb3.BaseSB3Loader.prototype.getAudioBuffer = function (path) {

    return this.getAsArrayBuffer(path)
      .then((buffer) => P.IO.decodeAudio(buffer))
      .catch((err) => {
      throw new Error(`Could not load audio: ${path} (${err})`);
    });

  }

  sb3.BaseSB3Loader.prototype.loadWatcher = function (data, stage) {

    if (data.mode === 'list') {
      return new sb3.Scratch3ListWatcher(stage, data);
    }

    return new sb3.Scratch3VariableWatcher(stage, data);

  }

  sb3.BaseSB3Loader.prototype.loadTarget = function (data) {

    const target = new (data.isStage ? Stage : Sprite)(null);

    for (const id of Object.keys(data.variables)) {

      const variable = data.variables[id];
      const name = variable[0];
      const value = variable[1];

      if (target.vars[name]) {
        continue;
      }

      if (variable.length > 2) {
        const cloud = variable[2];
        if (cloud) {
          if (data.isStage) {
            target.cloudVariables.push(name);
          } else {
            console.warn('Cloud variable found on a non-stage object. Skipping.');
          }
        }
      }

      target.vars[name] = value;
      target.varIds[id] = name;

    }

    for (const id of Object.keys(data.lists)) {

      const list = data.lists[id];
      const name = list[0];
      const content = list[1];
      if (target.lists[name]) {
        continue;
      }
      const scratchList = sb3.createList();
      for (var i = 0; i < content.length; i++) {
        scratchList[i] = content[i];
      }
      target.lists[name] = scratchList;
      target.listIds[id] = name;

    }

    target.name = data.name;
    target.currentCostumeIndex = data.currentCostume;
    target.sb3data = data;

    if ('volume' in data) {
      target.volume = data.volume / 100;
    }

    if (target.isStage) {

      target.videoTransparency = 1 - (data.videoTransparency || 0) / 100;

    } else {

      const sprite = target;
      sprite.scratchX = data.x;
      sprite.scratchY = data.y;
      sprite.visible = data.visible;
      sprite.direction = data.direction;
      sprite.scale = data.size / 100;
      sprite.isDraggable = data.draggable;
      sprite.rotationStyle = P.utils.parseRotationStyle(data.rotationStyle);

    }

    const costumesPromise = Promise.all(data.costumes.map((c, i) => this.loadCostume(c, i)));
    const soundsPromise = Promise.all(data.sounds.map((c) => this.loadSound(c)));

    return Promise.all([costumesPromise, soundsPromise])

      .then((result) => {
      const costumes = result[0];
      const sounds = result[1];
      target.costumes = costumes;
      sounds.forEach((sound) => sound && target.addSound(sound));
      return target;

    });

  }

  sb3.BaseSB3Loader.prototype.compileTargets = function (targets) {

    for (const target of targets) {
      const compiler = new P.sb3.compiler.Compiler(target);
      compiler.compile();
    }

  }

  sb3.BaseSB3Loader.prototype.load = async function () {
    
    this.resetTasks();

    const targets = await Promise.all(this.projectData.targets
      .sort((a, b) => a.layerOrder - b.layerOrder)
      .map((data) => this.loadTarget(data)));

    if (this.aborted) {
      throw new Error('Loading aborting.');
    }

    const stage = targets.filter((i) => i.isStage)[0];

    if (!stage) {
      throw new Error('Project does not have a Stage');
    }

    const sprites = targets.filter((i) => i.isSprite);

    sprites.forEach((sprite) => sprite.stage = stage);
    stage.children = sprites;
    stage.isSb3 = true;

    if (this.projectData.monitors) {
      stage.allWatchers = this.projectData.monitors
        .map((data) => this.loadWatcher(data, stage))
        .filter((i) => i && i.valid);
      stage.allWatchers.forEach((watcher) => watcher.init());
    }

    this.compileTargets(targets, stage);
    this.projectData = null;

    return stage;

  }

  sb3.SB3FileLoader = function(buffer) {

    sb3.BaseSB3Loader.call(this);
    this.buffer = buffer;

  }

  inherits(sb3.SB3FileLoader, sb3.BaseSB3Loader);

  sb3.SB3FileLoader.prototype.getAsText = function(path) {

    const task = this.addTask(new P.IO.Manual());
    const file = this.zip.file(path);
    if (!file) {
      throw new Error('cannot find file as text: ' + path);
    }
    return file.async('text')
      .then((response) => {
      task.markComplete();
      return response;
    });

  }

  sb3.SB3FileLoader.prototype.getAsArrayBuffer = function(path) {

    const task = this.addTask(new P.IO.Manual());
    const file = this.zip.file(path);

    if (!file) {
      throw new Error('cannot find file as arraybuffer: ' + path);
    }

    return file.async('arraybuffer')
      .then((response) => {
      task.markComplete();
      return response;
    });

  }

  sb3.SB3FileLoader.prototype.getAsBase64 = function(path) {

    const task = this.addTask(new P.IO.Manual());
    const file = this.zip.file(path);

    if (!file) {
      throw new Error('cannot find file as base64: ' + path);
    }

    return file.async('base64')
      .then((response) => {
      task.markComplete();
      return response;
    });

  }

  sb3.SB3FileLoader.prototype.getAsImage = function(path, format) {

    const task = this.addTask(new P.IO.Manual());
    return this.getAsBase64(path)
      .then((imageData) => {
        return P.IO.loadImage('data:image/' + format + ';base64,' + imageData);
    });

  }

  sb3.SB3FileLoader.prototype.load = function() {

    return JSZip.loadAsync(this.buffer)
      .then((data) => {
      this.zip = data;
      return this.getAsText('project.json');
    })
      .then((project) => {
      this.projectData = JSON.parse(project);
    })
      .then(() => sb3.BaseSB3Loader.prototype.load.call(this));

  }

  sb3.Scratch3Loader = function(idOrData) {

    sb3.BaseSB3Loader.call(this);

    if (typeof idOrData === 'object') {
      this.projectData = idOrData;
      this.projectId = null;
    } else {
      this.projectId = idOrData;
    }

  }

  inherits(sb3.Scratch3Loader, sb3.BaseSB3Loader);

  sb3.Scratch3Loader.prototype.getAsText = function(path) {
    return this.addTask(new P.IO.Request(sb3.ASSETS_API.replace('$md5ext', path))).ignoreErrors().load('text');
  }

  sb3.Scratch3Loader.prototype.getAsArrayBuffer = function(path) {
    return this.addTask(new P.IO.Request(sb3.ASSETS_API.replace('$md5ext', path))).ignoreErrors().load('arraybuffer');
  }

  sb3.Scratch3Loader.prototype.getAsImage = function(path) {

    return new Promise(async (resolve, reject) => {

      try {
        var req = await this.addTask(new P.IO.Request(sb3.ASSETS_API.replace('$md5ext', path))).load('blob');
        var img = await P.IO.loadImage(await P.IO.reader(req, 'dataurl'));
        resolve(img);
      } catch (err) {
        console.warn('Could not load image: ' + err);
        var img = await P.IO.loadDotImage();
        resolve(img);
      }
      
    });

  }

  sb3.Scratch3Loader.prototype.load = function() {

    if (this.projectId) {
      return this.addTask(new P.IO.Request(P.config.PROJECT_API.replace('$id', '' + this.projectId))).load('json')
        .then((data) => {
        this.projectData = data;
        return sb3.BaseSB3Loader.prototype.load.call(this);
      });
    } else {
      return sb3.BaseSB3Loader.prototype.load.call(this);
    }

  }

  var AudioContext = window.AudioContext || window.webkitAudioContext;
  var audioContext = AudioContext && new AudioContext;

  audioContext.mInit = false;

  document.addEventListener('touchend', function (e) {
    if (!audioContext.mInit) {
      audioContext.mInit = true;
      var osc = audioContext.createOscillator();
      osc.frequency.value = 0;
      osc.connect(audioContext.destination);
      osc.start(0);
      osc.stop(0);
    }
  }.bind(this));

  return {
    
    audioContext: audioContext,
    IO: IO,
    utils: utils,
    Base: Base,
    Stage: Stage,
    Sprite: Sprite,
    Watcher: Watcher,
    VectorCostume: VectorCostume,
    BitmapCostume: BitmapCostume,
    Costume: Costume,
    sb2: sb2,
    sb3: sb3,
    config: config,
    m3: m3,
    Shader: Shader,

  };

}());


P.runtime = (function(){

  var self, S, R, STACK, C, CALLS, WARP, BASE, BASERETURN, THREAD, IMMEDIATE, VISUAL, base_Return, TYPE_EVENT, myTHREAD;

  const epoch = Date.UTC(2000, 0, 1);

  var CastEngine = (function(){

    function isWhiteSpace(val) {
      return val === null || typeof val === 'string' && val.trim().length === 0;
    }

    function toBoolean(value) {
      // Already a boolean?
      if (typeof value === 'boolean') {
        return value;
      }

      if (typeof value === 'string') {
        // These specific strings are treated as false in Scratch.
        if (value === '' || value === '0' || value.toLowerCase() === 'false') {
          return false;
        } // All other strings treated as true.

        return true;
      } // Coerce other values and numbers.

      return Boolean(value);
    }

    function compare(v1, v2) {
      var n1 = Number(v1);
      var n2 = Number(v2);

      if (n1 === 0 && isWhiteSpace(v1)) {
        n1 = NaN;
      } else if (n2 === 0 && isWhiteSpace(v2)) {
        n2 = NaN;
      }

      if (isNaN(n1) || isNaN(n2)) {
        var s1 = String(v1).toLowerCase();
        var s2 = String(v2).toLowerCase();

        if (s1 < s2) {
          return -1;
        } else if (s1 > s2) {
          return 1;
        }

        return 0;
      }

      if (n1 === Infinity && n2 === Infinity || n1 === -Infinity && n2 === -Infinity) {
        return 0;
      }

      return n1 - n2 == 0 ? 0 : (n1 - n2 > 0 ? 1 : -1);
    }

    function equal(v1, v2) {

      var n1 = Number(v1);
      var n2 = Number(v2);

      if (n1 === 0 && isWhiteSpace(v1)) {
        n1 = NaN;
      } else if (n2 === 0 && isWhiteSpace(v2)) {
        n2 = NaN;
      }

      

      if (isNaN(n1) || isNaN(n2)) {

        var s1 = String(v1).toLowerCase();
        var s2 = String(v2).toLowerCase()

        return (s1 == s2);
      }

      return n1 == n2;
    }

    function toNumber(value) {
      // If value is already a number we don't need to coerce it with
      // Number().
      if (typeof value === 'number') {
        // Scratch treats NaN as 0, when needed as a number.
        // E.g., 0 + NaN -> 0.
        if (Number.isNaN(value)) {
          return 0;
        }

        return value;
      }

      var n = Number(value);

      if (Number.isNaN(n)) {
        // Scratch treats NaN as 0, when needed as a number.
        // E.g., 0 + NaN -> 0.
        return 0;
      }

      return n;
    }

    return {
      equal:equal,
      compare:compare,
      toBoolean:toBoolean,
      toNumber:toNumber,
    }
  }());

  var bool = function (v) {
    return CastEngine.toBoolean(v);
  };

  var compare = function (x, y) {
    return CastEngine.compare(x, y);
  };

  var equal = function (x, y) {
    return CastEngine.equal(x, y) == 1;
  };

  var stringContains = function (baseString, needle) {
    return baseString.toLowerCase().indexOf(needle.toLowerCase()) > -1;
  };

  var mod = function (x, y) {

    var r = x % y;

    if (r / y < 0) {
      r += y;
    }

    return r;
  };

  var random = function (x, y) {

    var fractional = (typeof x === 'string' && !isNaN(+x) && x.indexOf('.') > -1) ||
      (typeof y === 'string' && !isNaN(+y) && y.indexOf('.') > -1);

    x = +x || 0;
    y = +y || 0;

    if (x > y) {
      var tmp = y;
      y = x;
      x = tmp;
    }

    if (!fractional && (x % 1 === 0 && y % 1 === 0)) {
      return Math.floor(Math.random() * (y - x + 1)) + x;
    }

    return Math.random() * (y - x) + x;
  };

  var clone = function (name) {

    const parent = name === '_myself_' ? S : self.getObject(name);

    if (!parent || !parent.isSprite) {
      return;
    }

    const c = parent.clone();
    self.children.splice(self.children.indexOf(parent), 0, c);
    self.triggerFor(c, 'whenCloned');

    if (c.visible) {
      VISUAL = true;
    }

  };

  var getVars = function (name) {

    return self.vars[name] !== undefined ? self.vars : S.vars;

  };

  var getLists = function (name) {

    if (self.lists[name] !== undefined)
      return self.lists;

    if (S.lists[name] === undefined) {
      S.lists[name] = [];
    }

    return S.lists;
  };

  var listIndex = function (list, index, length) {

    var i = index | 0;
    
    if (i === index)
      return i > 0 && i <= length ? i - 1 : -1;

    if (index === 'random' || index === 'any') {
      return Math.random() * length | 0;
    }

    if (index === 'last') {
      return length - 1;
    }

    return i > 0 && i <= length ? i - 1 : -1;
  };

  var contentsOfList = function (list) {
    var isSingle = true;

    for (var i = list.length; i--;) {
      if (('' + list[i]).length !== 1) {
        isSingle = false;
        break;
      }
    }

    return list.join(isSingle ? '' : ' ');
  };

  var getLineOfList = function (list, index) {

    var i = listIndex(list, index, list.length);
    return i !== -1 ? list[i] : '';
  };

  var listContains = function (list, value) {

    for (var i = list.length; i--;) {
      if (equal(list[i], value))
        return true;
    }

    return false;
  };
  var listIndexOf = function (list, value) {

    for (var i = 0; i < list.length; i++) {
      if (equal(list[i], value))
        return i + 1;
    }

    return 0;
  };

  var appendToList = function (list, value) {

    list.push(value);

  };

  var deleteLineOfList = function (list, index) {

    if (index === 'all') {

      list.length = 0;

    } else {

      var i = listIndex(list, index, list.length);

      if (i === list.length - 1) {
        list.pop();
      } else if (i !== -1) {
        list.splice(i, 1);
      }

    }

  };

  var insertInList = function (list, index, value) {

    var i = listIndex(list, index, list.length + 1);

    if (i === list.length) {
      list.push(value);
    } else if (i !== -1) {
      list.splice(i, 0, value);
    }

  };

  var setLineOfList = function (list, index, value) {

    var i = listIndex(list, index, list.length);
    if (i !== -1) {
      list[i] = value;
    }

  };

  var watchedAppendToList = function (list, value) {

    appendToList(list, value);

    if (!list.modified)
      list.modified = true;

  };

  var watchedDeleteLineOfList = function (list, index) {

    deleteLineOfList(list, index);

    if (!list.modified)
      list.modified = true;

  };

  var watchedDeleteAllOfList = function (list) {

    list.length = 0;

    if (!list.modified)
      list.modified = true;

  };

  var watchedInsertInList = function (list, index, value) {

    insertInList(list, index, value);

    if (!list.modified)
      list.modified = true;

  };

  var watchedSetLineOfList = function (list, index, value) {

    setLineOfList(list, index, value);

    if (!list.modified)
      list.modified = true;

  };

  var mathFunc = function (f, x) {

    switch (f) {

      case 'abs':

        return Math.abs(x);

      case 'floor':

        return Math.floor(x);

      case 'sqrt':

        return Math.sqrt(x);

      case 'ceiling':

        return Math.ceil(x);

      case 'cos':

        return (Math.round(Math.cos(x * Math.PI / 180) * 1e10) / 1e10);

      case 'sin':

        return (Math.round(Math.sin(x * Math.PI / 180) * 1e10) / 1e10);

      case 'tan':

        return Math.tan(x * Math.PI / 180);

      case 'asin':

        return Math.asin(x) * 180 / Math.PI;

      case 'acos':

        return Math.acos(x) * 180 / Math.PI;

      case 'atan':

        return Math.atan(x) * 180 / Math.PI;

      case 'ln':

        return Math.log(x);

      case 'log':

        return Math.log(x) / Math.LN10;

      case 'e ^':

        return Math.exp(x);

      case '10 ^':

        return Math.pow(10, x);

    }

    return 0;

  };

  var attribute = function (attr, objName) {

    const o = self.getObject(objName);

    if (!o)

      return 0;

    if (o.isSprite) {

      switch (attr) {

        case 'x position': return o.scratchX;

        case 'y position': return o.scratchY;

        case 'direction': return o.direction;

        case 'costume #': return o.currentCostumeIndex + 1;

        case 'costume name': return o.costumes[o.currentCostumeIndex].name;

        case 'size': return o.scale * 100;

        case 'volume': return o.volume * 100;

      }

    } else {

      switch (attr) {

        case 'background #':

        case 'backdrop #': return o.currentCostumeIndex + 1;

        case 'backdrop name': return o.costumes[o.currentCostumeIndex].name;

        case 'volume': return o.volume * 100;

      }

    }

    const value = o.vars[attr];

    if (value !== undefined) {

      return value;

    }

    return 0;

  };

  var timeAndDate = function (format) {

    switch (format) {

      case 'year':

        return new Date().getFullYear();

      case 'month':

        return new Date().getMonth() + 1;

      case 'date':

        return new Date().getDate();

      case 'day of week':

        return new Date().getDay() + 1;

      case 'hour':

        return new Date().getHours();

      case 'minute':

        return new Date().getMinutes();

      case 'second':

        return new Date().getSeconds();

    }

    return 0;

  };
  function getKeyCode(keyName) {

    keyName = keyName + '';

    switch (keyName.toLowerCase()) {

      case 'space': return "32";

      case 'left arrow': return "left arrow";

      case 'up arrow': return "up arrow";

      case 'right arrow': return "right arrow";

      case 'down arrow': return "down arrow";

      case '\r': return "enter";

      case "\u0008" : return "66";

      case "\t" : return "84";

      case "\u001b" : return null;

      case "" : return null;

      case 'any': return 'any';

      case "" : {

        if (self.keys[67]) return "67";

        else if (self.keys[83]) return "83";

        else if (self.keys[65]) return "65";

        else return null;

      }

    }

    return '' + keyName.toUpperCase().charCodeAt(0);

  }

  var getKeyCode3 = function (keyName) {

    switch (keyName.toLowerCase()) {

      case 'space': return "32";

      case 'left arrow': return "left arrow";

      case 'up arrow': return "up arrow";

      case 'right arrow': return "right arrow";

      case 'down arrow': return "down arrow";

      case 'enter': return "enter";

      case 'any': return 'any';

    }

    return '' + keyName.toUpperCase().charCodeAt(0);

  };
  
  var audioContext = P.audioContext;

  if (audioContext) {
    var wavBuffers = P.IO.wavBuffers;
    var audioPlaySpan = function (span, key, duration, connection, lRVTinSB3) {
      if (!audioContext) {
        throw new Error('Cannot playSpan without an AudioContext');
      }
      const buffer = wavBuffers[span.name];
      if (!buffer) {
        throw new Error('No wavBuffers entry named: ' + span.name);
      }
      const source = audioContext.createBufferSource();
      const note = audioContext.createGain();
      source.buffer = buffer;
      if (!self.soundbankIsSB3) {
        if (source.loop = span.loop) {
          source.loopStart = span.loopStart;
          source.loopEnd = span.loopEnd;
        }
      }
      source.connect(note);
      note.connect(connection);
      const time = audioContext.currentTime;
      if (!self.soundbankIsSB3) {
        source.playbackRate.value = Math.pow(2, (key - 69) / 12) / span.baseRatio;
      } else {
        source.playbackRate.value = Math.pow(2, ((key - (span.top || 0)) - 60) / 12);
      }
      const gain = note.gain;

      if (!self.soundbankIsSB3) {

        gain.value = 0;

        gain.setValueAtTime(0, time);

        if (span.attackEnd < duration) {

          gain.linearRampToValueAtTime(1, time + span.attackEnd);

          if (span.decayTime > 0 && span.holdEnd < duration) {

            gain.linearRampToValueAtTime(1, time + span.holdEnd);

            if (span.decayEnd < duration) {

              gain.linearRampToValueAtTime(0, time + span.decayEnd);

            } else {

              gain.linearRampToValueAtTime(1 - (duration - span.holdEnd) / span.decayTime, time + duration);

            }

          } else {

            gain.linearRampToValueAtTime(1, time + duration);

          }

        } else {

          gain.linearRampToValueAtTime(1, time + duration);

        }

        gain.linearRampToValueAtTime(0, time + duration + 0.02267573696);
        source.start(time);
        source.stop(time + duration + 0.02267573696);

      } else {

        gain.setValueAtTime(gain.value, time + duration);
        gain.linearRampToValueAtTime(0.0001, time + duration + (lRVTinSB3 || 0));
        source.start(time);
        source.stop(time + duration + (lRVTinSB3 || 0));

      }
      return source;
    }
    var playDrum = function (span, key, duration, mapMidi) {

      var source;
      if (mapMidi) {

        var midiDescription = MIDI_DRUMS[span - 34];

        if (midiDescription) {

          span = midiDescription[0];

        } else {

          span = 2;

        }

        const spanMidi = span;

        if (self.soundbankIsSB3) {

          source = playSpan(P.IO.soundbankSb3.DRUMS[spanMidi], key, 10, 0);

        } else {

          source = playSpan(P.IO.soundbankSb2.DRUMS[spanMidi], key, 10, 0);

        } 

      } else {

        if (self.soundbankIsSB3) {

          source = playSpan(P.IO.soundbankSb3.DRUMS[span], key, 10, 0);

        } else {

          source = playSpan(P.IO.soundbankSb2.DRUMS[span], key, duration, 0);

        } 

      }

      if (self.soundbankIsSB3) {

        for (var i = 0; i < self.activeDrums.length; i++) {

          if (self.activeDrums[i].note == span) {

            if (duration != 0) {

              self.activeDrums[i].source.disconnect();

            }

          }

        }

        if (duration !== 0) {

          self.activeDrums.push({

            note:span,

            source:source.node,

            duration:duration

          });

        }

      }

      return source;

    };
    var playNote = function (key, duration) {

      var source;
      var span;

      if (self.soundbankIsSB3) {

        key = P.utils.clamp(key, 0, 130)

        var spans = P.IO.soundbankSb3.INSTRUMENTS[S.instrument];

        for (var i = 0; i < spans.length; i++) {

          var gh = (i * -1) + spans.length - 1;

          span = spans[gh];

          if ((Number(key) + 0) >= span.top){

            break;

          }

        }

        source = playSpan(span, Number(key) + 60, duration, lRVTSB3n[S.instrument],true);

      } else {

        var spans = P.IO.soundbankSb2.INSTRUMENTS[S.instrument];

        for (var i = 0, l = spans.length; i < l; i++) {

          span = spans[i];

          if (span.top >= key || span.top === 128)

            break;

        }

        source =  playSpan(span, key, duration, true);

      }

      if (self.soundbankIsSB3) {

        var u;

        u = false;

        for (var i = 0; i < self.activeNotes.length; i++) {

          if (self.activeNotes[i].inst == S.instrument) {

            if (self.activeNotes[i].note == key) {

              if (duration != 0) {

                self.activeNotes[i].source.disconnect();

                u = true;

              }

            }

          }

        }

        if (self._concurrencyCounter > CONCURRENCY_LIMIT) {

          source.node.disconnect();

        }

        if (!(self._concurrencyCounter > CONCURRENCY_LIMIT)) {

          if (!u) {

            self._concurrencyCounter++;

            source.node.addEventListener('ended',function(){

              self._concurrencyCounter--;

              if (self._concurrencyCounter < 0) {

                self._concurrencyCounter = 0;

              }

            });

          }

        }

        if (duration !== 0) {

          self.activeNotes.push({

            inst:S.instrument,

            note:key,

            source:source.node,

            duration:duration

          });

        } else {

          source.node.disconnect();

        }

      }

      return source;

    };
    var playSpan = function (span, key, duration, lRVTinSB3,isNote) {

      const node = audioPlaySpan(span, key, duration, S.getAudioNodeSpan(), lRVTinSB3, isNote);

      return {

        stopped: false,

        node,

        base: BASE,

        isSpan:true

      };

    };

    var applySoundEffects = function (node) {

      node.playbackRate.value = Math.pow(2, (S.soundFilters.pitch / 10 / 12));

    };

    var updateSoundEffectsOnAllSounds = function () {

      for (const sound of S.activeSounds) {

        if (sound.node) {

          applySoundEffects(sound.node);

        }

      }

    };

    var playSound = function (sound) {

      const node = sound.createSourceNode();

      applySoundEffects(node);

      node.connect(S.getAudioNode());

      return {

        stopped: false,

        isClone:S.isClone,

        sound_playuntildone:true,

        node,

        base: BASE,

      };

    };

    var startSound = function (sound) {

      for (const s of S.activeSounds) {

        if (s.node === sound.source) {

          s.stopped = true;

          break;

        }

      }

      const node = sound.createSourceNode();

      applySoundEffects(node);

      node.connect(S.getAudioNode());

      sound.isClone = S.isClone;

      sound.node = node;

    };

  }

  var save = function () {

    STACK.push(R);

    R = {};

  };

  var restore = function () {

    R = STACK.pop();

  };

  var call = function (procedure, id, values) {

    if (procedure) {

      STACK.push(R);

      CALLS.push(C);

      C = {

        base: procedure.fn,

        fn: S.fns[id],

        args: procedure.call(values),

        numargs: [],

        boolargs: [],

        stack: STACK = [],

        warp: procedure.warp,

      };

      R = {};

      if (C.warp || WARP) {

        WARP++;

        IMMEDIATE = procedure.fn;

      } else {

        if (VISUAL) {

          for (var i = CALLS.length, j = 5; i-- && j--;) {

            if (CALLS[i].base === procedure.fn) {

              self.queue[THREAD] = {

                sprite: S,

                base: BASE,

                baseReturn: BASERETURN,

                start: myTHREAD.start,

                visual_event: myTHREAD.visual_event,

                type_event: TYPE_EVENT,

                fn: procedure.fn,

                calls: CALLS,

                warp: WARP

              };

              return;

            }

          }

        }

        IMMEDIATE = procedure.fn;

      }

    } else {

      IMMEDIATE = S.fns[id];

    }

  };
  var endCall = function () {

    if (CALLS.length) {

      if (WARP)

        WARP--;

      IMMEDIATE = C.fn;

      C = CALLS.pop();

      STACK = C.stack;

      R = STACK.pop();

    }

  };

  var cloudVariableChanged = function (name) {

    if (self.cloudHandler) {

      self.cloudHandler.variableChanged(name);

    }

  };

  var parseColor = function (color) {

    return P.utils.parseColor(color);

  };

  var sceneChange = function () {

    var broadcast2s = self.trigger('whenSceneStarts', self.getCostumeName());

    for (let q2 = 0; q2 < broadcast2s.threadLish.length; q2++) {
      
      const y2 = broadcast2s.threadLish[q2];
      
      if ((y2.type_event.event == 'whenSceneStarts' && myTHREAD.type_event.event == 'whenSceneStarts')) {

        if (y2.type_event.arg == myTHREAD.type_event.arg) {
          
          y2.start = false;
          
        }
        
      }
     
    }

    return broadcast2s;

  };

  var broadcast = function (name) {

    var broadcast2s = self.trigger('whenIReceive', name);

    for (let q2 = 0; q2 < broadcast2s.threadLish.length; q2++) {
      
      const y2 = broadcast2s.threadLish[q2];
      
      if ((y2.type_event.event == 'whenIReceive' && myTHREAD.type_event.event == 'whenIReceive')) {

        if (y2.type_event.arg == myTHREAD.type_event.arg) {

          y2.start = false;
          
        }
        
      }
     
    }

    return broadcast2s;
  
  };

  var running = function (bases) {

    for (var j = 0; j < self.queue.length; j++) {
      
      if (self.queue[j] && bases.code.indexOf(self.queue[j].baseReturn.code) !== -1)

        return true;

    }

    return false;

  };

  var queue = function (id) {

    if (WARP) {

      IMMEDIATE = S.fns[id];

    } else {

      forceQueue(id);

    }

  };

  var forceQueue = function (id) {

    self.queue[THREAD] = {

      sprite: S,

      base: BASE,

      baseReturn: BASERETURN,

      start: myTHREAD.start,

      visual_event: myTHREAD.visual_event,

      type_event: TYPE_EVENT,

      fn: S.fns[id],

      calls: CALLS,

      warp: WARP

    };

  };

  (function(){

    P.Stage.prototype.framerate = 30;

    P.Stage.prototype.initRuntime = function() {

      this.queue = [];
      this.visual_event = [];
      this.isRunning = false;
      this.interval = null;
      this.frameStart = 0;
      this.onError = this.onError.bind(this);

    };

    P.Stage.prototype.now = function() {

      return this.baseNow + Date.now() - this.baseTime;

    };

    P.Stage.prototype.resetTimer = function() {

      this.timerStart = this.now();

    };

    P.Stage.prototype.startThread = function(sprite, base, event, arg) {

      var thread = {

        sprite: sprite,

        base: base,

        type_event: {event: event, arg: arg},

        start: true,

        visual_event: 0,

        fn: base,

        baseReturn: {code: null, threadLish: null},

        calls: [{args: [], stack: [{}]}],

        warp: 0

      };

      for (var i = 0; i < this.queue.length; i++) {

        var q = this.queue[i];

        if (q && q.sprite === sprite && q.base === base) {

          this.queue[i] = thread;

          return thread;

        }

      }

      this.queue.push(thread);

      return thread;

    };

    P.Stage.prototype.triggerFor = function(sprite, event, arg) {

      var threads;

      if (event === 'whenClicked') {

        threads = sprite.listeners.whenClicked;

      } else if (event === 'whenCloned') {

        threads = sprite.listeners.whenCloned;

      } else if (event === 'whenGreenFlag') {

        threads = sprite.listeners.whenGreenFlag;

      } else if (event === 'whenIReceive') {

        threads = sprite.listeners.whenIReceive[arg] || sprite.listeners.whenIReceive[arg.toLowerCase()];

      } else if (event === 'whenKeyPressed') {

        threads = sprite.listeners.whenKeyPressed[arg];

      } else if (event === 'whenSceneStarts') {

        threads = sprite.listeners.whenSceneStarts[('' + arg).toLowerCase()];

      } else if (event === 'edgeActivated') {

        threads = sprite.listeners.edgeActivated;

      }

      if (threads) {

        for (var i = 0; i < threads.length; i++) {

          base_Return.threadLish.push(this.startThread(sprite, threads[i], event, arg));

        }

      }

      return threads || [];

    };

    P.Stage.prototype.trigger = function(event, arg) {

      let threads = [];

      base_Return = {code: String(Math.ceil(Math.random() * 9999999999999999999)), threadLish: []};

      for (let i = this.stage.children.length; i--;) {

        threads = threads.concat(this.triggerFor(this.stage.children[i], event, arg));

      }

      threads.concat(this.triggerFor(this.stage, event, arg));

      base_Return.threadLish.forEach(p54 => {
        p54.baseReturn.code = base_Return.code;
        p54.baseReturn.threadLish = base_Return.threadLish;
      });

      return base_Return;

    };

    P.Stage.prototype.triggerGreenFlag = function() {

      this.stopped = false;

      this.overlay.step = 0;

      this.timerStart = this.now();

      this.trigger('whenGreenFlag');

      this.trigger('edgeActivated');

    };

    P.Stage.prototype.pause = function() {

      if (this.interval) {

        this.baseNow = this.now();

        clearInterval(this.interval);

        delete this.interval;

        removeEventListener('error', this.onError);

        if (P.audioContext)

          P.audioContext.suspend();

      }

      this.isRunning = false;

    };

    P.Stage.prototype.start = function() {

      this.isRunning = true;

      if (this.interval) return;

      P.audioContext.suspend();

      addEventListener('error', this.onError);

      this.baseTime = Date.now();

      this.frameStart = ((Date.now() - epoch) / 86400000);

      this.interval = setInterval(this.step.bind(this), 1000 / this.framerate);

    };

    P.Stage.prototype.step = function() {

      self = this.stage;

      VISUAL = false;

      self.cursorPointer = false;

      self.canvas.style.cursor = '';

      self.overlay.SpriteCloneCount = 0;

      self.overlay.g = 0;

      self.overlay.MousePressed = self.mousePressed;

      if (self.context.costumeTextures) self.stage.overlay.WebGlCostuneTextureCount = self.backdropContext.costumeTextures.size;
      if (self.context.costumeTextures) self.stage.overlay.WebGlCostuneTextureCount += self.penContext.costumeTextures.size;
      if (self.context.costumeTextures) self.stage.overlay.WebGlCostuneTextureCount += self.context.costumeTextures.size;
      if (self.context.costumeTextures) self.stage.overlay.WebGlCostuneTextureCount += self.glCollisionContext.costumeTextures.size;

      self.overlay.Timer = ((self.now() - self.timerStart) / 1000);

      for (var i = 0; i < self.stage.children.length; i++) {

        const c = self.stage.children[i];

        if (c.isClone) {

          self.overlay.SpriteCloneCount += 1;

        }

        if (c.isDragging) {

          c.moveTo(c.dragOffsetX + c.stage.mouseX, c.dragOffsetY + c.stage.mouseY);

        }

      }

      if (audioContext.state === 'suspended') {

        audioContext.resume();

      }

      const start = Date.now();

      const queue = this.queue;

      this.currentMSecs = this.whenTimerMSecs = this.now();

      do {

        for (THREAD = 0; THREAD < queue.length; THREAD++) {

          const thread = queue[THREAD];

          if (thread) {

            if (!thread.start) {
              self.visual_event.push(thread);
              continue;
            }

            myTHREAD = thread;

            S = thread.sprite;
            IMMEDIATE = thread.fn;
            BASE = thread.base;
            BASERETURN = thread.baseReturn;
            TYPE_EVENT = thread.type_event;
            CALLS = thread.calls;
            C = CALLS.pop();
            STACK = C.stack;
            R = STACK.pop();
            queue[THREAD] = undefined;
            WARP = thread.warp;

            while (IMMEDIATE) {

              const fn = IMMEDIATE;
              IMMEDIATE = null;
              fn();
              self.overlay.step += 1;

            }

            STACK.push(R);
            CALLS.push(C);
          }

        }

        for (let i = queue.length; i--;) {
          if (!queue[i]) {
            queue.splice(i, 1);
          }
        }

      } while ((this.isTurbo || !VISUAL) && queue.length && Date.now() - start < 1000 / this.framerate);

      for (let g5 = 0; g5 < self.visual_event.length; g5++) {
        const j3 = self.visual_event[g5];
        j3.start = true;
      }

      self.visual_event.length = 0;

      self.activeDrums.length = 0;
      self.activeNotes.length = 0;

      var d = (1 / ((((Date.now() - epoch) / 86400000) - this.frameStart) * 86400));

      self.overlay.FPS = Math.min(Math.round(d), this.framerate + 1);
      self.frameStart = ((Date.now() - epoch) / 86400000);
      self.draw();

      if (self.stopped) {
        self.stopAll();
        self.stopped = false;
      }
      

      if (this.nodeStage) this.nodeStage.gain.value = this.volumeStage;
      if(self.cursorPointer == true) self.canvas.style.cursor = 'pointer';

    };

    P.Stage.prototype.onError = function(e) {

      this.handleError(e.error);

      clearInterval(this.interval);

    };

    P.Stage.prototype.handleError = function(e) {

    };

    P.Stage.prototype.resetInterval = function() {

      if (this.interval) {

        clearInterval(this.interval);

      }

      this.interval = setInterval(this.step.bind(this), 1000 / this.framerate);

    };

    P.Stage.prototype.stopAll = function() {
      this.hidePrompt = false;
      this.prompter.style.display = 'none';
      this.promptId = this.nextPromptId = 0;
      this.queue.length = 0;
      this._concurrencyCounter = 0;
      this.resetFilters();
      if (this.node) {
        for (const sound of this.activeSounds) {
          if (sound.node) {
            sound.stopped = true;
            sound.node.disconnect();
          }
        }
        this.activeSounds.clear();
        this.node.disconnect();
        this.node = null;
      }
      for (var i = 0; i < this.children.length; i++) {
        const c = this.children[i];
        if (c.node) {
          for (const sound of c.activeSounds) {
            if (sound.node) {
              sound.stopped = true;
              sound.node.disconnect();
            }
          }
          c.activeSounds.clear();
          c.node.disconnect();
          c.node = null;
        }
        if (c.isClone) {
          c.remove();
          this.children.splice(i, 1);
          i -= 1;
        } else {
          c.resetFilters();
          if (c.saying && c.isSprite)
            c.say('');
        }
      }
      if (this.nodeStage) {
        this.nodeStage.disconnect();
        this.nodeStage = null;  
      }
      P.audioContext.suspend();
    };

  }())

  var CONCURRENCY_LIMIT = Infinity;
  var lRVTSB3n = [
    0.5,
    0.5,
    0.5,
    0.5,
    0.5,
    0.25,
    0.25,
    0.1,
    0.01,
    0.01,
    0.01,
    0.01,
    0.01,
    0.01,
    0.25,
    0.5,
    0.25,
    0.5,
    0.01,
    0.1,
    0.25
  ]

  var MIDI_INSTRUMENTS = [1, 1, 1, 1, 2, 2, 4, 4, 17, 17, 17, 16, 19, 16, 17, 17, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 7, 8, 19, 8, 8, 8, 8, 15, 15, 15, 19, 9, 9, 9, 9, 9, 9, 9, 9, 11, 11, 11, 11, 14, 14, 14, 10, 12, 12, 13, 13, 13, 13, 12, 12, 20, 20, 20, 20, 20, 20, 20, 20, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 4, 4, 4, 4, 17, 14, 8, 10, 17, 17, 18, 19, 1, 1, 1, 1, 21, 21, 21, 21, 21, 21, 21, 21];
  var MIDI_DRUMS = [[1, -4], [1, 0], [2, 0], [0, 0], [7, 0], [0, 2], [1, -6, 4], [5, 0], [1, -3, 3.2], [5, 0], [1, 0, 3], [4, -8], [1, 4, 3], [1, 7, 2.7], [3, -8], [1, 10, 2.7], [4, -2], [3, -11], [4, 2], [6, 0], [3, 0, 3.5], [10, 0], [3, -8, 3.5], [16, -6], [4, 2], [12, 2], [12, 0], [13, 0, 0.2], [13, 0, 2], [13, -5, 2], [12, 12], [12, 5], [10, 19], [10, 12], [14, 0], [14, 0], [17, 12], [17, 5], [15, 0], [15, 0], [8, 0], [9, 0], [9, -4], [17, -5], [17, 0], [11, -6, 1], [11, -6, 3]];
 
  return {
    scopedEval: function(source) {
      return eval(source);
    },
    getKeyCode:getKeyCode,
    createContinuation: function(source) {
      var result = '(function() {\n';
      var brackets = 0;
      var delBrackets = 0;
      var shouldDelete = false;
      var here = 0;
      var length = source.length;
      while (here < length) {
        var i = source.indexOf('{', here);
        var j = source.indexOf('}', here);
        var k = source.indexOf('return;', here);
        if (k === -1)
            k = length;
        if (i === -1 && j === -1) {
            if (!shouldDelete) {
                result += source.slice(here, k);
            }
            break;
        }
        if (i === -1)
            i = length;
        if (j === -1)
            j = length;
        if (shouldDelete) {
            if (i < j) {
                delBrackets++;
                here = i + 1;
            }
            else {
                delBrackets--;
                if (!delBrackets) {
                    shouldDelete = false;
                }
                here = j + 1;
            }
        } else {
            if (brackets === 0 && k < i && k < j) {
                result += source.slice(here, k);
                break;
            }
            if (i < j) {
                result += source.slice(here, i + 1);
                brackets++;
                here = i + 1;
            }
            else {
                result += source.slice(here, j);
                here = j + 1;
                if (source.substr(j, 8) === '} else {') {
                    if (brackets > 0) {
                        result += '} else {';
                        here = j + 8;
                    }
                    else {
                        shouldDelete = true;
                        delBrackets = 0;
                    }
                }
                else {
                    if (brackets > 0) {
                        result += '}';
                        brackets--;
                    }
                }
            }
        }
      }
      result += '})';
      return eval(result);
    },
  };

}());

P.player = (function(){

  class LoaderIdentifier {

    constructor() {

      this.active = true;
      this.loader = null;

    }

    cancel() {

      if (!this.active) {

        throw new Error('cannot cancel: already cancelled');

      }

      this.active = false;

      if (this.loader) {

        this.loader.abort();

      }

    }

    setLoader(loader) {

      if (!this.active) {

        throw new Error('Loading aborted');

      }

      this.loader = loader;

    }

    isActive() {

      return this.active;

    }

  }

  class Slot {

    constructor() {

      this._listeners = [];

    }

    subscribe(fn) {

      this._listeners.push(fn);

    }

    emit(value) {

      for (const listener of this._listeners) {

        listener(value);

      }

    }

  }


  class LocalProjectMeta {

    constructor(filename) {

        this.filename = filename;

    }

    load() {

        return Promise.resolve(this);

    }

    getTitle() {

        return this.filename;

    }

    getId() {

        return this.filename;

    }

    isFromScratch() {

        return false;

    }

  }

  class BinaryProjectMeta {

    load() {

        return Promise.resolve(this);

    }

    getTitle() {

        return null;

    }

    getId() {

        return '#buffer#';

    }

    isFromScratch() {

        return false;

    }

}

  class RemoteProjectMeta {
    constructor(id) {
      this.id = id;
      this.title = null;
      this.onload = new Slot();
      this.onerror = new Slot();
    }
    async load() {
      return new Promise(function (resolve,reject) {
        fetch('https://trampoline.turbowarp.org/proxy/projects/$id'.replace('$id', this.id)).then((res) => {
          if (res.status == 200) {
            res.json().then((jsn) => {
              this.title = jsn.title;
              this.onload.emit(this);
              resolve(this);
            });
          } else { 
            this.title = null;
            this.onerror.emit();
            resolve(this);
          }
        }).catch((err) => {
          this.title = null;
          this.onerror.emit();
          resolve(this);
        })
      }.bind(this))
    }
    getTitle() {
      return this.title;
    }
    getId() {
      return this.id;
    }
    isFromScratch() {
      return true;
    }
  }

  var Player = function (options = {}) {
    this.onprogress = new Slot();
    this.onload = new Slot();
    this.onstartload = new Slot();
    this.oncleanup = new Slot();
    this.onthemechange = new Slot();
    this.onerror = new Slot();
    this.onresume = new Slot();
    this.onpause = new Slot();
    this.onoptionschange = new Slot();
    this.stage = null;
    this.ResZoom = null;
    this.projectMeta = null;
    this.zip = null;
    this.zoom = 1;
    this.progress = 0;
    this.isAutoPlay = false;

    this.MAGIC = {

      LARGE_Z_INDEX: '9999999999',

    };

    this.overlay = {

      'SpriteCloneCount': 0,
      'FPS': 0,
      'WebGlCostuneTextureCount': 0,
      'Timer': 0,
      'MousePressed': 0,
      'step': 0,

    };

    this.root = document.createElement('div');
    this.root.className = 'forkphorus-player-root';
    this.loadingContainer = document.createElement('div');
    this.loadingContainer.className = 'player-loading';
    var loadingF = document.createElement('div');
    loadingF.className = 'loadingF';
    this.loadingContainer.appendChild(loadingF)
    var ClogoF = document.createElement('div');
    ClogoF.className = 'ClogoF';
    ClogoF.innerHTML = '©2022 AnimTred'
    this.loadingContainer.appendChild(ClogoF);
    var logoS = document.createElement('div');
    logoS.className = 'logoS';
    logoS.innerHTML = 'Pinkiephorus';
    loadingF.appendChild(logoS);
    this.root.appendChild(this.loadingContainer)
    var progress = document.createElement('div');
    progress.className = 'progress';
    loadingF.appendChild(progress);
    this.progress_bar = document.createElement('div');
    this.progress_bar.className = 'progress-bar';
    progress.appendChild(this.progress_bar);
    this.playerContainer = document.createElement('div');
    this.playerContainer.className = 'player-stage';
    this.root.appendChild(this.playerContainer);
    this.root.appendChild(this.loadingContainer);
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.className = 'player-control';
    this.root.appendChild(this.controlsContainer);
    this.setZoom(this.zoom)
    var flagButton = document.createElement('img');
    flagButton.className = 'player-button player-flag';
    flagButton.src = P.IO.config.localPath + "assets/flag.svg";
    this.controlsContainer.appendChild(flagButton);
    flagButton.onclick = (e) => {
      this.triggerGreenFlag();
    }
    var pauseButton = document.createElement('img');
    pauseButton.className = 'player-button player-pause';
    pauseButton.src = P.IO.config.localPath + "assets/pause.svg";
    this.loadingContainer.style.display = 'none';
    this.controlsContainer.appendChild(pauseButton);
    pauseButton.onclick = (e) => {
      this.toggleRunning();
      if (!this.isRunning()) {
        pauseButton.src = P.IO.config.localPath + "assets/resume.svg";
      } else {
        pauseButton.src = P.IO.config.localPath + "assets/pause.svg";
      }
    }
    var stopButton = document.createElement('img');
    stopButton.className = 'player-button player-stop';
    stopButton.src = P.IO.config.localPath + "assets/stop.svg";
    this.pauseButton = pauseButton;
    var fullscreenButton = document.createElement('img');
    fullscreenButton.className = 'player-button player-fullscreen';
    fullscreenButton.src = P.IO.config.localPath + "assets/fulscreenopen.svg";
    this.fullscreenButton = fullscreenButton;
    this.controlsContainer.appendChild(stopButton);
    this.loadingContainer.style.display = 'none';
    this.controlsContainer.appendChild(fullscreenButton);
    stopButton.onclick = (e) => {
      this.stopAll();
    }
    fullscreenButton.onclick = (e) => {
      if (!this.stage) return;
      this.setOptions({ fullscreenMode: e.shiftKey ? 'window' : 'full' });
      if (this.fullscreenEnabled) {
        fullscreenButton.src = P.IO.config.localPath + "assets/fulscreenopen.svg";
        this.exitFullscreen();
      } else {
        fullscreenButton.src = P.IO.config.localPath + "assets/fulscreenclose.svg";
        this.enterFullscreen();
      }
    }
    this.controlsContainer.style.display = 'none';
    var Statsfornerds = document.createElement('div');
    Statsfornerds.className = 'player-Statsfornerds';
    var Statsfornerds2 = document.createElement('div');
    Statsfornerds2.innerHTML = '[X]';
    Statsfornerds2.style.position = 'absolute';
    Statsfornerds2.style.right = '5px';
    Statsfornerds2.onclick = function () {
      Statsfornerds.style.display = 'none';
    }
    Statsfornerds.appendChild(Statsfornerds2);
    var Statsfornerds3 = document.createElement('div');
    Statsfornerds.appendChild(Statsfornerds3);
    this.Statsfornerds = Statsfornerds;
    this.Statsfornerds2 = Statsfornerds3;
    this.root.appendChild(Statsfornerds);
    this.Init3dot();
    this.updateStatsNerds();
    Statsfornerds.style.display = 'none';
    setInterval(function(){

      if (this.stage) {

        this.overlay = {

          'SpriteCloneCount': this.stage.overlay.SpriteCloneCount,

          'FPS': this.stage.overlay.FPS,

          'WebGlCostuneTextureCount': this.stage.overlay.WebGlCostuneTextureCount,

          'Timer': this.stage.overlay.Timer,

          'MousePressed': this.stage.overlay.MousePressed,

          'step': this.stage.overlay.step,

        }

      }

      if (!!this.stage && !!this.stage.queue && !!this.stage.queue.length) {

        stopButton.style.opacity = 1;
        flagButton.style.background = 'rgb(87 251 44 / 54%)';
        flagButton.style['border-radius'] = '15%';

      } else {

        stopButton.style.opacity = 0.65;
        flagButton.style.background = 'none';
        flagButton.style['border-radius'] = '25%';

      }

      this.updateStatsNerds();

    }.bind(this), 20);
    
    this.setOptions(Object.assign(Object.assign({}, options), Player.DEFAULT_OPTIONS));

    window.addEventListener('resize', () => this.updateFullscreen());

    document.addEventListener('fullscreenchange', () => this.onfullscreenchange());
    document.addEventListener('mozfullscreenchange', () => this.onfullscreenchange());
    document.addEventListener('webkitfullscreenchange', () => this.onfullscreenchange());

  }

  Player.prototype.updateStatsNerds = function() {
    this.Statsfornerds2.innerHTML = `<div>Sprite Clone Count: <span>${this.overlay.SpriteCloneCount}</span></div><div>FPS: <span></span>${this.overlay.FPS}</div><div>Costune Texture Count: <span>${this.overlay.WebGlCostuneTextureCount}</span></div><div>Timer: <span>${this.overlay.Timer}</span></div><div>Mouse Pressed: <span>${this.overlay.MousePressed}</span></div><div>step: <span>${this.overlay.step}</span></div>`;
  }

  Player.prototype.Init3dot = function() {

    this.z3dot = document.createElement('a');
    this.z3dot.className = 'player-button_player-3dot';
    this.z3dot.style.position = 'relative';
    var z3dotIcon = document.createElement('img');
    z3dotIcon.src = P.IO.config.localPath + "assets/3dot.svg";
    this.z3dot.appendChild(z3dotIcon);
    var z3dotExamples = document.createElement('select');
    z3dotExamples.className = 'z3dotExamples';
    this.z3dot.appendChild(z3dotExamples)
    z3dotExamples.innerHTML = '<option value="" style="display: none;"></option>';
    var z3dotscreenshot = document.createElement('option');
    z3dotscreenshot.value = 'screenshot';
    z3dotscreenshot.innerHTML = 'Save Screenshot';
    z3dotExamples.appendChild(z3dotscreenshot);
    var z3dotstatsforneeds = document.createElement('option');
    z3dotstatsforneeds.value = 'statsforneeds';
    z3dotstatsforneeds.innerHTML = 'Stats for nerds';
    z3dotExamples.appendChild(z3dotstatsforneeds);
    z3dotExamples.addEventListener('change', function() {
      if (z3dotExamples.value == 'screenshot') {
        if (this.stage) {
          this.stage.screenshot();
        }
      }
      if (z3dotExamples.value == 'statsforneeds') {
        this.Statsfornerds.style = '';
      }
    }.bind(this));
    this.controlsContainer.appendChild(this.z3dot);
    this.loadingContainer.style.display = 'none';

  };

  Player.prototype.updateFullscreen = function() {

    if ((window.devicePixelRatio || 1) !== P.config.scale) {
      P.config.scale = (window.devicePixelRatio || 1);
      if (this.stage) this.stage.resizeAllCanvas(this.stage.zoom);
    };

    if (!this.fullscreenEnabled) {
      return;
    }

    if (!this.stage) return;

    window.scrollTo(0, 0);
    let w = window.innerWidth - this.options.fullscreenPadding * 2;
    let h = window.innerHeight - this.options.fullscreenPadding;
    w = Math.min(w, h / 0.75);
    w = Math.min(w, this.options.fullscreenMaxWidth);
    h = w * 0.75 + 0;
    this.root.style.paddingLeft = (window.innerWidth - w) / 2 + 'px';
    this.root.style.paddingTop = (window.innerHeight - h - this.options.fullscreenPadding) / 2 + 'px';
    this.stage.setZoom(w / 480);

  }

  Player.prototype.enterFullscreen = function() {

    this.ResZoom = this.zoom;
    this.setOptions({ theme: 'dark' });

    if (this.options.fullscreenMode === 'full') {
      if (this.root.requestFullScreenWithKeys) {
        this.root.requestFullScreenWithKeys();
      } else if (this.root.webkitRequestFullScreen) {
        this.root.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);
      } else if (this.root.requestFullscreen) {
        this.root.requestFullscreen();
      }
    }

    document.body.classList.add('player-body-fullscreen');
    this.root.style.zIndex = this.MAGIC.LARGE_Z_INDEX;
    this.enableAttribute('fullscreen');
    this.fullscreenEnabled = true;

    if (this.hasStage()) {
      if (!this.isRunning()) {
        this.stage.draw();
      }
      if (this.options.focusOnLoad) {
        this.focus();
      }
    }

    this.updateFullscreen();

  }

  Player.prototype.exitFullscreen = function() {
    this.setOptions({ theme: this.savedTheme });
    this.disableAttribute('fullscreen');
    this.fullscreenEnabled = false;
    if (document.fullscreenElement === this.root || document.webkitFullscreenElement === this.root) {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.webkitCancelFullScreen) {
        document.webkitCancelFullScreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
    this.root.style.paddingLeft = '';
    this.root.style.paddingTop = '';
    this.root.style.zIndex = '0';
    if (this.controlsContainer) {
      this.controlsContainer.style.width = '';
    }
    document.body.classList.remove('player-body-fullscreen');
    if (this.stage) {
      this.setZoom(this.ResZoom);
      this.focus();
    }
  }

  Player.prototype.isRunning = function() {
    if (!this.hasStage()) {
      return false;
    }
    return this.stage.isRunning;
  }

  Player.prototype.getProjectMeta = function(name) {
    if (!this.projectMeta) {
      throw new Error('no project meta');
    }
    return this.projectMeta;
  }

  Player.prototype.hasStage = function(name) {
    return !!this.stage;
  }

  Player.prototype.pause = function(name) {
    if (!this.stage) return;
    if (!this.isRunning()) {
      return;
    }
    this.pauseButton.src = P.IO.config.localPath + "assets/resume.svg";
    this.stage.pause();
    this.onpause.emit();
  }

  Player.prototype.resume = function(name) {
    if (!this.stage) return;
    if (this.isRunning()) {
      return;
    }
    this.pauseButton.src = P.IO.config.localPath + "assets/pause.svg";
    this.stage.start();
    this.onresume.emit();
  }

  Player.prototype.toggleRunning = function(name) {
    if (!this.stage) return;
    if (this.stage.isRunning) {
      this.pause();
    } else {
      this.resume();
    }
  }

  Player.prototype.enableAttribute = function(name) {
    this.root.setAttribute(name, '');
  }

  Player.prototype.disableAttribute = function(name) {
    this.root.removeAttribute(name);
  }

  Player.prototype.setAttribute = function(enabled) {
    if (enabled) {
      this.enableAttribute(name);
    } else {
      this.disableAttribute(name);
    }
  }

  Player.prototype.applyOptionsToStage = function() {
    if (this.stage.framerate !== this.options.fps) {
      this.stage.framerate = this.options.fps;
      if (this.isRunning()) {
        this.stage.resetInterval();
      }
    }
    this.stage.username = this.options.username;
    this.stage.isTurbo = this.options.turbo;
    this.stage.useSpriteFencing = this.options.spriteFencing;
    this.stage.removeLimits = this.options.removeLimits;
    if (this.options.controls) this.controlsContainer.style = '';
    if (this.options.soundbank != 'auto') {
      if (this.options.soundbank == 'sb3') {
        this.stage.soundbankIsSB3 = true;
      } else {
        this.stage.soundbankIsSB3 = false;
      }  
    }
  }

  Player.prototype.setOptions = function(changedOptions) {
    this.options = Object.assign(Object.assign({}, this.options), changedOptions);
    if (this.hasStage()) {
      this.applyOptionsToStage();
    }
    this.onoptionschange.emit(changedOptions);
  };

  Player.prototype.reset = function() {
    this.controlsContainer.style.display = 'none';
    this.loadingContainer.style.display = '';
    console.log('Reset Player')
    this.renderPreLoad(0);
    this.removeClickToPlayContainer();
    if (this.stage) this.stage.destroy();
    this.stage = null;
  };

  Player.prototype.determineProjectType = function (data) {
    if ('objName' in data)
      return 'sb2';
    if ('targets' in data)
      return 'sb3';
    throw new Error('Unknown project type');
  }

  Player.prototype.showClickToPlayContainer = function () {
    if (this.clickToPlayContainer) {
      return;
    }
    this.clickToPlayContainer = document.createElement('div');
    this.clickToPlayContainer.className = 'player-click-to-play-container';
    this.clickToPlayContainer.onclick = () => {
      if (P.audioContext && P.audioContext.state !== 'running') {
        P.audioContext.resume();
      }
      this.removeClickToPlayContainer();
      this.triggerGreenFlag();
      this.focus();
    };
    const content = document.createElement('div');
    content.className = 'player-click-to-play-icon';
    this.clickToPlayContainer.appendChild(content);
    this.stage.ui.appendChild(this.clickToPlayContainer);
  }

  Player.prototype.removeClickToPlayContainer = function () {
    if (!this.clickToPlayContainer) return;
    if (!this.stage) return;
    this.stage.ui.removeChild(this.clickToPlayContainer);
    this.clickToPlayContainer = null;
  }

  Player.prototype.fetchProject = async function(id) {

    const request = new P.IO.Request(this.options.projectHost.replace('$id', id));
    return request
      .ignoreErrors()
      .load('blob')
      .then(function (response) {
        return response;
    });

  }

  Player.prototype.loadProjectById = async function(id) {
    const { loaderId } = this.beginLoadingProject();
    this.projectMeta = new RemoteProjectMeta(id);
    const blob = await this.fetchProject(id);
    const loader = await this.getLoader(blob);
    await this.loadLoader(loaderId, loader);
  }

  Player.prototype.onfullscreenchange = function(url) {
    if (typeof document.fullscreen === 'boolean' && document.fullscreen !== this.fullscreenEnabled) {
      this.exitFullscreen();
    } else if (typeof document.webkitIsFullScreen === 'boolean' && document.webkitIsFullScreen !== this.fullscreenEnabled) {
        this.exitFullscreen();
    }
  }

  Player.prototype.loadProjectURL = async function(url) {
    this.reset();
    const blob = await new P.IO.Request(url).load('blob');
    this.loadProjectFromFile(blob);
  }

  Player.prototype.loadProjectFromBufferWithType = async function(loaderId, buffer, type) {
    let loader;
    if (type === 'sb') {
      buffer = await this.convertScratch1Project(buffer);
      type = 'sb2';
    }
    switch (type) {
      case 'sb2':
        loader = new P.sb2.SB2FileLoader(buffer);
        break;
      case 'sb3':
        loader = new P.sb3.SB3FileLoader(buffer);
        break;
      default: throw new Error('Unknown type: ' + type);
    }
    await this.loadLoader(loaderId, loader);
  }

  Player.prototype.loadProjectFromBuffer = async function(buffer, type) {

    const { loaderId } = this.beginLoadingProject();

    try {

      this.projectMeta = new BinaryProjectMeta();
      return await this.loadProjectFromBufferWithType(loaderId, buffer, type);

    } catch (e) {
      console.log(e)
      if (loaderId.isActive()) {
        this.handleError(e);
      }

    }

  }

  Player.prototype.convertScratch1Project = async function(buffer) {
    const sb1 = new ScratchSB1Converter.SB1File(buffer);
    const projectData = sb1.json;
    const zipFiles = sb1.zip.files;
    const zip = new JSZip();
    console.log('dsf');
    zip.file('project.json', JSON.stringify(projectData));
    for (const fileName of Object.keys(zipFiles)) {
      zip.file(fileName, zipFiles[fileName].bytes);
    }
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  Player.prototype.cleanup = function () {
    this.reset();
    this.oncleanup.emit();
  }

  Player.prototype.isScratch1Project = function(buffer) {
    const MAGIC = 'ScratchV0';
    const array = new Uint8Array(buffer);
    var txt = '';
    for (var i = 0; i < MAGIC.length; i++) {
      txt = '' + txt + String.fromCharCode(array[i]);
    }
    return txt == MAGIC;
  }

  Player.prototype.beginLoadingProject = function () {
    this.cleanup();
    this.onstartload.emit();
    const loaderId = new LoaderIdentifier();
    this.currentLoader = loaderId;
    return { loaderId };
  }

  Player.prototype.loadLoader = async function (loaderId, loader) {
    loaderId.setLoader(loader);
    loader.onprogress = (progress) => {
      this.renderPreLoad(progress);
    }
    await P.IO.loadSoundbankSB3();
    await P.IO.loadSoundbankSB2();
    const stage = await loader.load();
    this.loadingContainer.style.display = 'none';
    stage.soundbankIsSB3 = stage.isSb3;
    stage.setZoom(this.zoom);
    P.audioContext.suspend();
    this.setStage(stage);
    stage.projectMeta = this.projectMeta;
    this.currentLoader = null;
    loader.cleanup();
    return stage;
  }

  Player.prototype.getLoader = async function(blob) {
    try {
      const projectText = await P.IO.reader(blob,'text');
      const projectJson = P.IO.parseJSONish(projectText);
      switch (this.determineProjectType(projectJson)) {
        case 'sb2': return new P.sb2.Scratch2Loader(projectJson);
        case 'sb3': return new P.sb3.Scratch3Loader(projectJson);
      }
    } catch (err) {
      let buffer = await P.IO.reader(blob,'arraybuffer');
      if (this.isScratch1Project(buffer)) {
        buffer = await this.convertScratch1Project(buffer);
      } else {
        const zip = await JSZip.loadAsync(buffer);
        const projectJSON = zip.file('project.json');
        const projectDataText = await projectJSON.async('text');
        const projectData = P.IO.parseJSONish(projectDataText);
        if (this.determineProjectType(projectData) === 'sb3') {
          return new P.sb3.SB3FileLoader(buffer);
        }
      }
      return new P.sb2.SB2FileLoader(buffer);
    }
  }
  Player.prototype.getStage = function(blob) {
    if (!this.stage) {
      throw new Error('Missing stage.');
    }
    return this.stage;
  }
  Player.prototype.loadProjectFromFile = async function(file) {
    const { loaderId } = this.beginLoadingProject();
    this.projectMeta = new LocalProjectMeta(file.name);
    const loader = await this.getLoader(file);
    await this.loadLoader(loaderId, loader);
  };

  Player.prototype.renderPreLoad = function(payloadS) {
    this.progress_bar.style.width = 5 + payloadS * 95 + '%';
  };

  Player.prototype.generateUsernameIfMissing = function() {
    if (!this.options.username) {
      this.setOptions({
        username: 'player' + Math.random().toFixed(10).substr(2, 6)
      });
    }
  }

  Player.prototype.applyCloudVariablesSocket = function(stage, id) {
    this.generateUsernameIfMissing();
    const handler = new P.ext.cloud.WebSocketCloudHandler(stage, this.options.cloudHost, id);
    stage.setCloudHandler(handler);
  }

  Player.prototype.applyCloudVariablesLocalStorage = function(stage, id) {
    const handler = new P.ext.cloud.LocalStorageCloudHandler(stage, id);
    stage.setCloudHandler(handler);
  }

  Player.prototype.applyCloudVariables = function(policy) {
    const stage = this.stage;
    const meta = this.projectMeta;
    const hasCloudVariables = stage.cloudVariables.length > 0;
    if (!hasCloudVariables) {
      return;
    }
    switch (policy) {
      case 'ws':
        if (meta.isFromScratch()) {
          this.applyCloudVariablesSocket(stage, meta.getId());
        }
        break;
      case 'localStorage':
        if (meta.isFromScratch()) {
          this.applyCloudVariablesLocalStorage(stage, meta.getId());
        }
        break;
    }
  }

  Player.prototype.setStage = function(stage) {
    this.stage = stage;
    this.playerContainer.appendChild(stage.root);
    if (this.options.focusOnLoad) {
        this.focus();
    }
    this.stage.isComplete = true;
    this.onload.emit(stage);
    this.stage.draw();
    this.applyOptionsToStage();
    this.applyCloudVariables(this.options.cloudVariables);
    this.applyAutoplayPolicy(this.options.autoplayPolicy);
  };

  Player.prototype.applyAutoplayPolicy = function(policy) {
    switch (policy) {
      case 'always': {
        this.triggerGreenFlag();
        break;
      }
      case 'if-audio-playable': {
        if (!P.audio.context || P.audio.context.state === 'running') {
          this.triggerGreenFlag();
        }
        else {
          this.showClickToPlayContainer();
        }
        break;
      }
      case 'never': {
        this.showClickToPlayContainer();
        break;
      }
    }
  };

  Player.prototype.focus = function() {
    this.stage.focus();
  };

  Player.prototype.triggerGreenFlag = function() {

    if (!this.stage) return;
    P.audioContext.resume();
    if (!this.isRunning()) {
      this.resume();
    }
    this.stage.stopAll();
    this.stage.triggerGreenFlag();
    if (this.clickToPlayContainer) {
      this.removeClickToPlayContainer();
    }

  };

  Player.prototype.stopAll = function() {

    if (!this.stage) return;
    this.stage.stopAll();

  };

  Player.prototype.setZoom = function(scale) {
    
    this.zoom = scale;
    if (this.fullscreenEnabled) return;
    if (this.stage) this.stage.setZoom(this.zoom);
    this.root.style['font-size'] = 15 * this.zoom + 'px';
    this.root.style.width = Math.ceil(480 * this.zoom) + 'px';
    this.root.style.height = Math.ceil(360 * this.zoom) + 'px';

  };

  Player.DEFAULT_OPTIONS = {

    autoplayPolicy: 'always',
    cloudVariables: 'ws',
    fps: 30,
    theme: 'light',
    turbo: false,
    username: '',
    fullscreenMode: 'full',
    fullscreenPadding: 8,
    fullscreenMaxWidth: Infinity,
    imageSmoothing: false,
    focusOnLoad: false,
    spriteFencing: true,
    controls:false,
    removeLimits: false,
    soundbank:'auto',
    projectHost: 'https://projects.scratch.mit.edu/$id',
    cloudHost: 'wss://stratus.turbowarp.org'

  };

  return {Player:Player}

}());

P.sb2.compiler = (function(){

  var EVENT_SELECTORS = [
    'procDef',
    'whenClicked',
    'whenCloned',
    'whenGreenFlag',
    'whenIReceive',
    'whenKeyPressed',
    'whenSceneStarts',
    'whenSensorGreaterThan'
  ];
  var compiler_1 = {};
  var warnings;

  var warn = function (message) {
    warnings[message] = (warnings[message] || 0) + 1;
  };

  var compileScripts = function(object) {
    for (var i = 0; i < object.scripts.length; i++) {
      compiler_1.compileListener(object, object.scripts[i][2]);
    }
  };

  compiler_1.compileListener = function(object, script) {

    if (!script[0] || EVENT_SELECTORS.indexOf(script[0][0]) === -1)
      return;

    var nextLabel = function () {
      return object.fns.length + fns.length;
    };

    var label = function () {
      var id = nextLabel();
      fns.push(source.length);
      visual = 0;
      return id;
    };

    var delay = function () {
      source += 'return;\n';
      label();
    };

    var queue = function (id) {
      source += 'queue(' + id + ');\n';
      source += 'return;\n';
    };

    var forceQueue = function (id) {
      source += 'forceQueue(' + id + ');\n';
      source += 'return;\n';
    };

    var seq = function (script) {
      if (!script)
        return;
      for (var i = 0; i < script.length; i++) {
        compile(script[i]);
      }
    };

    var bool = function (e) {
      if (typeof e === 'boolean') {
        return e;
      }
      if (typeof e === 'number' || typeof e === 'string') {
        return +e !== 0 && e !== '' && e !== 'false';
      }
      if (e == null) {
        return 'false';
      }
      var v = boolval(e);
      return v != null ? v : val(e, false, true);
    };

    var num = function (e) {
      if (typeof e === 'number') {
        return e || 0;
      }
      if (typeof e === 'boolean' || typeof e === 'string') {
        return +e || 0;
      }
      if (e == null) {
        return '0';
      }
      var v = numval(e);
      return v != null ? v : val(e, true);
    };

    var varRef = function (name) {
      if (typeof name !== 'string') {
        return 'getVars(' + val(name) + ')[' + val(name) + ']';
      }
      var o = object.stage.vars[name] !== undefined ? 'self' : 'S';
      return o + '.vars[' + val(name) + ']';
    };

    var listRef = function (name) {
      if (typeof name !== 'string') {
        return 'getLists(' + val(name) + ')[' + val(name) + ']';
      }
      var o = object.stage.lists[name] !== undefined ? 'self' : 'S';
      if (o === 'S' && !object.lists[name]) {
        object.lists[name] = [];
      }
      return o + '.lists[' + val(name) + ']';
    };

    var param = function (name, usenum, usebool) {
      if (typeof name !== 'string') {
        throw new Error('Dynamic parameters are not supported');
      }
      if (!inputs)
        return '0';
      var i = inputs.indexOf(name);
      if (i === -1) {
        return '0';
      }
      var t = types[i];
      var kind = t === '%n' || t === '%d' || t === '%c' ? 'num' :
        t === '%b' ? 'bool' : '';
      if (kind === 'num' && usenum) {
        used[i] = true;
        return 'C.numargs[' + i + ']';
      }
      if (kind === 'bool' && usebool) {
        used[i] = true;
        return 'C.boolargs[' + i + ']';
      }
      var v = 'C.args[' + i + ']';
      if (usenum)
        return '(+(' + v + ') || 0)';
      if (usebool)
        return 'bool(' + v + ')';
      return v;
    };

    var val2 = function (e) {

      var v;

      if (e[0] === 'costumeName') {

        return 'S.getCostumeName()';

      } else if (e[0] === 'sceneName') {

        return 'self.getCostumeName()';

      } else if (e[0] === 'readVariable') {

        return varRef(e[1]);

      } else if (e[0] === 'contentsOfList:') {

        return 'contentsOfList(' + listRef(e[1]) + ')';

      } else if (e[0] === 'getLine:ofList:') {

        return 'getLineOfList(' + listRef(e[2]) + ', ' + val(e[1]) + ')';

      } else if (e[0] === 'concatenate:with:') {

        return '("" + ' + val(e[1]) + ' + ' + val(e[2]) + ')';

      } else if (e[0] === 'letter:of:') {

        return '(("" + ' + val(e[2]) + ')[(' + num(e[1]) + ' | 0) - 1] || "")';

      } else if (e[0] === 'answer') {

        return 'self.answer';

      } else if (e[0] === 'getAttribute:of:') {

        return 'attribute(' + val(e[1]) + ', ' + val(e[2]) + ')';

      } else if (e[0] === 'getUserId') {

        return '0';

      } else if (e[0] === 'getUserName') {

        return 'self.username';

      } else {

        warn('Undefined val: ' + e[0]);

      }

    };

    var val = function (e, usenum, usebool) {
      var v;

      if (typeof e === 'number' || typeof e === 'boolean' || e === null) {

        return '' + e;

      } else if (typeof e === 'string') {

        return '"' + e

          .replace(/\\/g, '\\\\')

          .replace(/\n/g, '\\n')

          .replace(/\r/g, '\\r')

          .replace(/"/g, '\\"')

          .replace(/\{/g, '\\x7b')

          .replace(/\}/g, '\\x7d') + '"';

      } else if (e[0] === 'getParam') {

        return param(e[1], usenum, usebool);

      } else if ((v = numval(e)) != null || (v = boolval(e)) != null) {

        return v;

      } else {

        v = val2(e);

        if (usenum)

          return '(+' + v + ' || 0)';

        if (usebool)

          return 'bool(' + v + ')';

        return v;

      }

    };

    var numval = function (e) {

      if (e[0] === 'xpos') {

        return 'S.scratchX';

      } else if (e[0] === 'ypos') {

        return 'S.scratchY';

      } else if (e[0] === 'heading') {

        return 'S.direction';

      } else if (e[0] === 'costumeIndex') {

        return '(S.currentCostumeIndex + 1)';

      } else if (e[0] === 'backgroundIndex') {

        return '(self.currentCostumeIndex + 1)';

      } else if (e[0] === 'scale') {

        return 'Math.round(S.scale * 100)';

      } else if (e[0] === 'volume') {

        return '(S.volume * 100)';

      } else if (e[0] === 'tempo') {

        return 'self.tempoBPM';

      } else if (e[0] === 'lineCountOfList:') {

        return listRef(e[1]) + '.length';

      } else if (e[0] === '+') {

        return '((+(' + num(e[1]) + ') || 0) + (+(' + num(e[2]) + ') || 0))';

      } else if (e[0] === '-') {

        return '((+(' + num(e[1]) + ') || 0) - (+(' + num(e[2]) + ') || 0))';

      } else if (e[0] === '*') {

        return '((+(' + num(e[1]) + ') || 0) * (+(' + num(e[2]) + ') || 0))';

      } else if (e[0] === '/') {

        return '((+(' + num(e[1]) + ') || 0) / (+(' + num(e[2]) + ') || 0))';

      } else if (e[0] === 'randomFrom:to:') {

        return 'random(' + num(e[1]) + ', ' + num(e[2]) + ')';

      } else if (e[0] === 'abs') {

        return 'Math.abs(' + num(e[1]) + ')';

      } else if (e[0] === 'sqrt') {

        return 'Math.sqrt(' + num(e[1]) + ')';

      } else if (e[0] === 'stringLength:') {

        return '("" + ' + val(e[1]) + ').length';

      } else if (e[0] === '%' || e[0] === '\\\\') {

        return 'mod(' + num(e[1]) + ', ' + num(e[2]) + ')';

      } else if (e[0] === 'rounded') {

        return 'Math.round(' + num(e[1]) + ')';

      } else if (e[0] === 'computeFunction:of:') {

        return 'mathFunc(' + val(e[1]) + ', ' + num(e[2]) + ')';

      } else if (e[0] === 'mouseX') {

        return 'self.mouseX';

      } else if (e[0] === 'mouseY') {

        return 'self.mouseY';

      } else if (e[0] === 'timer') {

        return '((self.now() - self.timerStart) / 1000)';

      } else if (e[0] === 'distanceTo:') {

        return 'S.distanceTo(' + val(e[1]) + ')';

      } else if (e[0] === 'soundLevel') {

        object.stage.initMicrophone();

        return 'self.microphone.getLoudness()';

      } else if (e[0] === 'timestamp') {

        return '((Date.now() - epoch) / 86400000)';

      } else if (e[0] === 'timeAndDate') {

        return 'timeAndDate(' + val(e[1]) + ')';

      }

    };

    var boolval = function (e) {
      if (e[0] === 'list:contains:') {

        return 'listContains(' + listRef(e[1]) + ', ' + val(e[2]) + ')';

      } else if (e[0] === '<' || e[0] === '>') {

        return '(compare(' + val(e[1]) + ', ' + val(e[2]) + ') === ' + (e[0] === '<' ? '-1' : '1') + ')';

      } else if (e[0] === '=') {

        return '(equal(' + val(e[1]) + ', ' + val(e[2]) + '))';

      } else if (e[0] === '&') {

        return '(CastEngine.toBoolean(' + bool(e[1]) + ') && CastEngine.toBoolean(' + bool(e[2]) + '))';

      } else if (e[0] === '|') {

        return '(CastEngine.toBoolean(' + bool(e[1]) + ') || CastEngine.toBoolean(' + bool(e[2]) + '))';

      } else if (e[0] === 'not') {

        return '!CastEngine.toBoolean(' + bool(e[1]) + ')';

      } else if (e[0] === 'mousePressed') {

        return 'self.mousePressed';

      } else if (e[0] === 'touching:') {

        return 'S.touching(' + val(e[1]) + ')';

      } else if (e[0] === 'touchingColor:') {

        return 'S.touchingColor(' + val(e[1]) + ')';

      } else if (e[0] === 'color:sees:') {

        return 'S.colorTouchingColor(' + val(e[1]) + ', ' + val(e[2]) + ')';

      } else if (e[0] === 'keyPressed:') {

        return '!!self.keys[getKeyCode(' + val(e[1]) + ')]';
        
      }

    };

    var beatHead = function (dur) {

      source += 'save();\n';
      source += 'R.start = self.currentMSecs;\n';
      source += 'R.duration = ' + num(dur) + ' * 60 / self.tempoBPM;\n';
      source += 'var first = true;\n';

    };

    var beatTail = function () {

      var id = label();
      source += 'if (!R.sound) R.sound = { stopped: false };';
      source += 'S.activeSounds.add(R.sound);\n';
      source += 'if ((self.currentMSecs - R.start < R.duration * 1000 || first) && !R.sound.stopped) {\n';
      source += '  var first;\n';
      forceQueue(id);
      source += '}\n';
      source += 'S.activeSounds.delete(R.sound);';
      source += 'restore();\n';

    };

    var wait = function (dur) {

      source += 'save();\n';
      source += 'R.start = self.now();\n';
      source += 'R.duration = (+' + dur + ' || 0);\n';
      source += 'var first = true;\n';
      var id = label();
      source += 'if (self.now() - R.start < R.duration * 1000 || first) {\n';
      source += '  var first;\n';
      forceQueue(id);
      source += 'VISUAL = true;\n';
      source += '}\n';
      source += 'restore();\n';

    };

    var toHSLA = 'var CopyColor = {\n';
    toHSLA += 'x:S.penColor.x,\n';
    toHSLA += 'y:S.penColor.y,\n';
    toHSLA += 'z:S.penColor.z,\n';
    toHSLA += 'type:S.penColor.type\n';
    toHSLA += '}\n';
    toHSLA += 'S.penColor.toHSLA();\n';
    toHSLA += 'S.penColor.a = 1;\n';

    var visual = 0;

    var compile = function(block) {

      if (['turnRight:', 'turnLeft:', 'heading:', 'pointTowards:', 'setRotationStyle', 'lookLike:', 'nextCostume', 'say:duration:elapsed:from:', 'say:', 'think:duration:elapsed:from:', 'think:', 'changeGraphicEffect:by:', 'setGraphicEffect:to:', 'filterReset', 'changeSizeBy:', 'setSizeTo:', 'comeToFront', 'goBackByLayers:'].indexOf(block[0]) !== -1) {
        if (visual < 2) {
          source += 'if (S.visible) VISUAL = true;\n';
          visual = 2;
        }
      } else if (['forward:', 'gotoX:y:', 'gotoSpriteOrMouse:', 'changeXposBy:', 'xpos:', 'changeYposBy:', 'ypos:', 'bounceOffEdge', 'glideSecs:toX:y:elapsed:from:'].indexOf(block[0]) !== -1) {
        if (visual < 1) {
          source += 'if (S.visible || S.isPenDown) VISUAL = true;\n';
          visual = 1;
        }
      } else if (['showBackground:', 'startScene', 'nextBackground', 'nextScene', 'startSceneAndWait', 'show', 'hide', 'putPenDown', 'stampCostume', 'showVariable:', 'hideVariable:', 'showList', 'hideList', 'doAsk', 'setVolumeTo:', 'changeVolumeBy:', 'setTempoTo:', 'changeTempoBy:', 'clearPenTrails', 'putPenDown', 'stampCostume', 'playDrum', 'drum:duration:elapsed:from:', 'rest:elapsed:from:', 'noteOn:duration:elapsed:from:', 'wait:elapsed:from:'].indexOf(block[0]) !== -1) {
        if (visual < 3) {
          source += 'VISUAL = true;\n';
          visual = 3;
        }
      }

      if (block[0] === 'forward:') {

        source += 'S.forward(' + num(block[1]) + ');\n';

      } else if (block[0] === 'turnRight:') {

        source += 'S.setDirection(S.direction + ' + num(block[1]) + ');\n';

      } else if (block[0] === 'turnLeft:') {

        source += 'S.setDirection(S.direction - ' + num(block[1]) + ');\n';

      } else if (block[0] === 'heading:') {

        source += 'S.setDirection(' + num(block[1]) + ');\n';

      } else if (block[0] === 'pointTowards:') {

        source += 'S.pointTowards(' + val(block[1]) + ');\n';

      } else if (block[0] === 'gotoX:y:') {

        source += 'S.moveTo(' + num(block[1]) + ', ' + num(block[2]) + ');\n';

      } else if (block[0] === 'gotoSpriteOrMouse:') {

        source += 'S.gotoObject(' + val(block[1]) + ');\n';

      } else if (block[0] === 'changeXposBy:') {

        source += 'S.moveTo(S.scratchX + ' + num(block[1]) + ', S.scratchY);\n';

      } else if (block[0] === 'xpos:') {

        source += 'S.moveTo(' + num(block[1]) + ', S.scratchY);\n';

      } else if (block[0] === 'changeYposBy:') {

        source += 'S.moveTo(S.scratchX, S.scratchY + ' + num(block[1]) + ');\n';

      } else if (block[0] === 'ypos:') {

        source += 'S.moveTo(S.scratchX, ' + num(block[1]) + ');\n';

      } else if (block[0] === 'bounceOffEdge') {

        source += 'S.bounceOffEdge();\n';

      } else if (block[0] === 'setRotationStyle') {

        source += 'S.rotationStyle = P.utils.parseRotationStyle(' + val(block[1]) + ');\n';

      } else if (block[0] === 'lookLike:') {

        source += 'S.setCostume(' + val(block[1]) + ');\n';

      } else if (block[0] === 'nextCostume') {

        source += 'S.showNextCostume();\n';

      } else if (block[0] === 'showBackground:' || block[0] === 'startScene') {

        source += 'self.setCostume(' + val(block[1]) + ');\n';
        source += 'var threads = sceneChange();\n';
        source += 'if (threads.code.indexOf(BASERETURN.code) !== -1) {return;}\n';

      } else if (block[0] === 'nextBackground' || block[0] === 'nextScene') {

        source += 'S.showNextCostume();\n';
        source += 'var threads = sceneChange();\n';
        source += 'if (threads.code.indexOf(BASERETURN.code) !== -1) {return;}\n';

      } else if (block[0] === 'startSceneAndWait') {

        source += 'save();\n';
        source += 'self.setCostume(' + val(block[1]) + ');\n';
        source += 'R.threads = sceneChange();\n';
        source += 'if (threads.code.indexOf(BASERETURN.code) !== -1) {return;}\n';
        var id = label();
        source += 'if (!running(R.threads)) {\n';
        forceQueue(id);
        source += '}\n';
        source += 'restore();\n';

      } else if (block[0] === 'say:duration:elapsed:from:') {

        source += 'save();\n';
        source += 'R.id = S.say(' + val(block[1]) + ', false);\n';
        source += 'R.start = self.currentMSecs;\n';
        source += 'R.duration = ' + num(block[2]) + ';\n';
        source += 'var first = true;\n';
        var id = label();
        source += 'if (self.currentMSecs - R.start < R.duration * 1000 || first) {\n';
        source += '  var first;\n';
        forceQueue(id);
        source += '}\n';
        source += 'if (S.sayId === R.id) {\n';
        source += '  S.say("");\n';
        source += '}\n';
        source += 'restore();\n';

      } else if (block[0] === 'say:') {

        source += 'S.say(' + val(block[1]) + ', false);\n';

      } else if (block[0] === 'think:duration:elapsed:from:') {

        source += 'save();\n';
        source += 'R.id = S.say(' + val(block[1]) + ', true);\n';
        source += 'R.start = self.now();\n';
        source += 'R.duration = ' + num(block[2]) + ';\n';
        source += 'var first = true;\n';
        var id = label();
        source += 'if (self.now() - R.start < R.duration * 1000) {\n';
        source += '  var first;\n';
        forceQueue(id);
        source += '}\n';
        source += 'if (S.sayId === R.id) {\n';
        source += '  S.say("");\n';
        source += '}\n';
        source += 'restore();\n';

      } else if (block[0] === 'think:') {

        source += 'S.say(' + val(block[1]) + ', true);\n';

      } else if (block[0] === 'changeGraphicEffect:by:') {

        source += 'S.changeFilter(' + val(block[1]) + ', ' + num(block[2]) + ');\n';

      } else if (block[0] === 'setGraphicEffect:to:') {

        source += 'S.setFilter(' + val(block[1]) + ', ' + num(block[2]) + ');\n';

      } else if (block[0] === 'filterReset') {

        source += 'S.resetFilters();\n';

      } else if (block[0] === 'changeSizeBy:') {

        source += 'var f = S.scale + ' + num(block[1]) + ' / 100;\n';
        source += 'S.scale = f < 0 ? 0 : f;\n';

      } else if (block[0] === 'setSizeTo:') {

        source += 'var f = ' + num(block[1]) + ' / 100;\n';
        source += 'S.scale = f < 0 ? 0 : f;\n';

      } else if (block[0] === 'show') {

        source += 'S.visible = true;\n';
        source += 'if (S.saying) S.updateBubble();\n';

      } else if (block[0] === 'hide') {

        source += 'S.visible = false;\n';
        source += 'if (S.saying) S.updateBubble();\n';

      } else if (block[0] === 'comeToFront') {

        source += 'var i = self.children.indexOf(S);\n';
        source += 'if (i !== -1) self.children.splice(i, 1);\n';
        source += 'self.children.push(S);\n';

      } else if (block[0] === 'goBackByLayers:') {

        source += 'var i = self.children.indexOf(S);\n';
        source += 'if (i !== -1) {\n';
        source += '  self.children.splice(i, 1);\n';
        source += '  self.children.splice(Math.max(0, i - ' + num(block[1]) + '), 0, S);\n';
        source += '}\n';

      } else if (block[0] === 'setVideoState') {
        
        source += 'switch (' + val(block[1]) + ') {';
        source += '  case "off": self.showVideo(false); break;';
        source += '  case "on": self.showVideo(true); break;';
        source += '}';

      } else if (block[0] === 'playSound:') {

        if (P.audioContext) {

          source += 'var sound = S.getSound(' + val(block[1]) + ');\n';
          source += 'if (sound) startSound(sound);\n';

        }

      } else if (block[0] === 'doPlaySoundAndWait') {

        if (P.audioContext) {

          source += 'var sound = S.getSound(' + val(block[1]) + ');\n';
          source += 'if (sound) {\n';
          source += '  save();\n';
          source += '  R.sound = playSound(sound);\n';
          source += '  S.activeSounds.add(R.sound);\n';
          source += '  R.start = self.now();\n';
          source += '  R.duration = sound.duration;\n';
          source += '  var first = true;\n';
          var id = label();
          source += '  if ((self.now() - R.start < R.duration * 1000 || first) && !R.sound.stopped) {\n';
          source += '    var first;\n';
          forceQueue(id);
          source += '  }\n';
          source += '  S.activeSounds.delete(R.sound);\n';
          source += '  restore();\n';
          source += '}\n';

        }

      } else if (block[0] === 'stopAllSounds') {

        if (P.audioContext) {
          source += 'self.stopAllSounds();\n';
        }

      } else if (block[0] === 'playDrum') {

        beatHead(block[2]);

        if (P.audioContext) {
          source += 'R.sound = playDrum(Math.round(' + num(block[1]) + ') - 1 || 0, 60, 10);\n';
        }

        beatTail();

      } else if (block[0] === 'drum:duration:elapsed:from:') {

        beatHead(block[2]);
        if (P.audioContext) {
          source += 'R.sound = playDrum(Math.round(' + num(block[1]) + ') - 1 || 0, 60, 10, true);\n';
        }
        beatTail();

      } else if (block[0] === 'rest:elapsed:from:') {

        beatHead(block[1]);
        beatTail();

      } else if (block[0] === 'noteOn:duration:elapsed:from:') {

        beatHead(block[2]);
        if (P.audioContext) {
          source += 'R.sound = playNote(' + num(block[1]) + ', R.duration);\n';
        }
        beatTail();

      } else if (block[0] === 'instrument:') {

        source += 'S.instrument = Math.max(0, Math.min(21 - 1, ' + num(block[1]) + ' - 1)) | 0;';

      } else if (block[0] === 'midiInstrument:') { 

        source += 'S.instrument = MIDI_INSTRUMENTS[Math.max(0, Math.min(128 - 1, ' + num(block[1]) + ' - 1)) | 0] - 1;';
      
      } else if (block[0] === 'changeVolumeBy:' || block[0] === 'setVolumeTo:') {
        source += 'S.volume = Math.min(1, Math.max(0, ' + (block[0] === 'changeVolumeBy:' ? 'S.volume + ' : '') + num(block[1]) + ' / 100));\n';
        source += 'if (S.node) S.node.gain.value = S.volume;\n';
      
      } else if (block[0] === 'changeTempoBy:') {

        source += 'self.tempoBPM += ' + num(block[1]) + ';\n';
      
      } else if (block[0] === 'setTempoTo:') {

        source += 'self.tempoBPM = ' + num(block[1]) + ';\n';
      
      } else if (block[0] === 'clearPenTrails') {

        source += 'self.clearPen();\n';
      
      } else if (block[0] === 'putPenDown') {

        source += 'S.isPenDown = true;\n';
        source += 'S.dotPen();\n';

      } else if (block[0] === 'putPenUp') {

        source += 'S.isPenDown = false;\n';

      } else if (block[0] === 'penColor:') {

        source += 'S.penColor.setRGBA(' + num(block[1]) + ');\n';

      } else if (block[0] === 'setPenHueTo:') {

        source += toHSLA;
        source += 'if (CopyColor.type == \'RGBA\' && (CopyColor.x == CopyColor.y && CopyColor.x == CopyColor.z && CopyColor.y == CopyColor.x && CopyColor.y == CopyColor.z && CopyColor.z == CopyColor.x && CopyColor.z == CopyColor.y)) {'
        source += 'S.penColor.z = 50;\n';
        source += '}\n';
        source += 'S.penColor.x = ' + num(block[1]) + ' * 360 / 200;\n';
        source += 'S.penColor.y = 100;\n';

      } else if (block[0] === 'changePenHueBy:') {

        source += toHSLA;
        source += 'if (CopyColor.type == \'RGBA\' && (CopyColor.x == CopyColor.y && CopyColor.x == CopyColor.z && CopyColor.y == CopyColor.x && CopyColor.y == CopyColor.z && CopyColor.z == CopyColor.x && CopyColor.z == CopyColor.y)) {'
        source += 'S.penColor.z = 50;\n';
        source += '}\n';
        source += 'S.penColor.x += ' + num(block[1]) + ' * 360 / 200;\n';
        source += 'S.penColor.y = 100;\n';

      } else if (block[0] === 'setPenShadeTo:') {

        source += toHSLA;
        source += 'S.penColor.z = ' + num(block[1]) + ' % 200;\n';
        source += 'if (S.penColor.z < 0) S.penColor.z += 200;\n';
        source += 'S.penColor.y = 100;\n';

      } else if (block[0] === 'changePenShadeBy:') {

        source += toHSLA;
        source += 'if (CopyColor.type == \'RGBA\' && (CopyColor.x == CopyColor.y && CopyColor.x == CopyColor.z && CopyColor.y == CopyColor.x && CopyColor.y == CopyColor.z && CopyColor.z == CopyColor.x && CopyColor.z == CopyColor.y)) {'
        source += 'S.penColor.z = 50;\n';
        source += '}\n';
        source += 'S.penColor.z = (S.penColor.z + ' + num(block[1]) + ') % 200;\n';
        source += 'if (S.penColor.z < 0) S.penColor.z += 200;\n';
        source += 'S.penColor.y = 100;\n';

      } else if (block[0] === 'penSize:') {

        source += 'var f = ' + num(block[1]) + ';\n';
        source += 'S.penSize = f < 1 ? 1 : f;\n';

      } else if (block[0] === 'changePenSizeBy:') {

        source += 'var f = S.penSize + ' + num(block[1]) + ';\n';
        source += 'S.penSize = f < 1 ? 1 : f;\n';

      } else if (block[0] === 'stampCostume') {

        source += 'S.stamp();\n';

      } else if (block[0] === 'setVar:to:') {

        source += varRef(block[1]) + ' = ' + val(block[2]) + ';\n';

      } else if (block[0] === 'changeVar:by:') {

        var ref = varRef(block[1]);
        source += ref + ' = (+(' + ref + ') || 0) + ' + num(block[2]) + ';\n';

      } else if (block[0] === 'append:toList:') {

        source += 'appendToList(' + listRef(block[2]) + ', ' + val(block[1]) + ');\n';

      } else if (block[0] === 'deleteLine:ofList:') {

        source += 'deleteLineOfList(' + listRef(block[2]) + ', ' + val(block[1]) + ');\n';

      } else if (block[0] === 'insert:at:ofList:') {
        
        source += 'insertInList(' + listRef(block[3]) + ', ' + val(block[2]) + ', ' + val(block[1]) + ');\n';

      } else if (block[0] === 'setLine:ofList:to:') {

        source += 'setLineOfList(' + listRef(block[2]) + ', ' + val(block[1]) + ', ' + val(block[3]) + ');\n';

      } else if (block[0] === 'showVariable:' || block[0] === 'hideVariable:') {

        var isShow = block[0] === 'showVariable:';

        if (typeof block[1] === 'string') {
          var o = object.vars[block[1]] !== undefined ? 'S' : 'self';
          source += o + '.showVariable(' + val(block[1]) + ', ' + isShow + ');\n';
        } else {
          warn('ignoring dynamic variable');
        }

      } else if (block[0] === 'showList:' || block[0] === 'hideList:') {

        var isShow = block[0] === 'showList:';
        if (typeof block[1] === 'string') {

          var o = object.lists[block[1]] !== undefined ? 'S' : 'self';
          source += o + '.showList(' + val(block[1]) + ', ' + isShow + ');\n';

        } else {

          warn('ignoring dynamic list');

        }

      } else if (block[0] === 'broadcast:') {

        source += 'var threads = broadcast(' + val(block[1]) + ');\n';
        source += 'if (threads.code.indexOf(BASERETURN.code) !== -1) {return;}\n';

      } else if (block[0] === 'call') {

        source += 'call(S.procedures[' + val(block[1]) + '], ' + nextLabel() + ', [';
        for (var i = 2; i < block.length; i++) {
          if (i > 2) {
            source += ', ';
          }
          source += val(block[i]);
        }
        source += ']);\n';
        delay();

      } else if (block[0] === 'doBroadcastAndWait') {

        source += 'save();\n';
        source += 'R.threads = broadcast(' + val(block[1]) + ');\n';
        source += 'if (R.threads.code.indexOf(BASERETURN.code) !== -1) {return;}\n';
        var id = label();
        source += 'if (running(R.threads)) {\n';
        forceQueue(id);
        source += '}\n';
        source += 'restore();\n';

      } else if (block[0] === 'doForever') {

        var id = label();
        seq(block[1]);
        forceQueue(id);

      } else if (block[0] === 'doForeverIf') {

        var id = label();
        source += 'if (' + bool(block[1]) + ') {\n';
        seq(block[2]);
        source += '}\n';
        forceQueue(id);

      } else if (block[0] === 'doIf') {

        source += 'if (' + bool(block[1]) + ') {\n';
        seq(block[2]);
        source += '}\n';

      } else if (block[0] === 'doIfElse') {

        source += 'if (' + bool(block[1]) + ') {\n';
        seq(block[2]);
        source += '} else {\n';
        seq(block[3]);
        source += '}\n';

      } else if (block[0] === 'doRepeat') {

        source += 'save();\n';
        source += 'R.count = ' + num(block[1]) + ';\n';
        var id = label();
        source += 'if (R.count >= 0.5) {\n';
        source += '  R.count -= 1;\n';
        seq(block[2]);
        queue(id);
        source += '} else {\n';
        source += '  restore();\n';
        source += '}\n';

      } else if (block[0] === 'doReturn') {

        source += 'endCall();\n';
        source += 'return;\n';

      } else if (block[0] === 'doUntil') {

        var id = label();
        source += 'if (!' + bool(block[1]) + ') {\n';
        seq(block[2]);
        queue(id);
        source += '}\n';

      } else if (block[0] === 'doWhile') {

        var id = label();
        source += 'if (' + bool(block[1]) + ') {\n';
        seq(block[2]);
        queue(id);
        source += '}\n';

      } else if (block[0] === 'doWaitUntil') {

        var id = label();
        source += 'if (!' + bool(block[1]) + ') {\n';
        forceQueue(id);
        source += '}\n';

      } else if (block[0] === 'glideSecs:toX:y:elapsed:from:') {

        source += 'if (S.visible || S.isPenDown) VISUAL = true;\n';
        source += 'save();\n';
        source += 'R.start = self.now();\n';
        source += 'R.duration = ' + num(block[1]) + ';\n';
        source += 'R.baseX = S.scratchX;\n';
        source += 'R.baseY = S.scratchY;\n';
        source += 'R.deltaX = ' + num(block[2]) + ' - S.scratchX;\n';
        source += 'R.deltaY = ' + num(block[3]) + ' - S.scratchY;\n';
        var id = label();
        source += 'var f = (self.now() - R.start) / (R.duration * 1000);\n';
        source += 'if (f > 1 || isNaN(f)) f = 1;\n';
        source += 'S.moveTo(R.baseX + f * R.deltaX, R.baseY + f * R.deltaY);\n';
        source += 'if (S.visible || S.isPenDown) VISUAL = true;\n';
        source += 'if (f < 1) {\n';
        forceQueue(id);
        source += '}\n';
        source += 'restore();\n';

      } else if (block[0] === 'stopAll') {

        source += 'self.stopAll();\n';
        source += 'return;\n';

      } else if (block[0] === 'stopScripts') {

        source += 'switch (' + val(block[1]) + ') {\n';
        source += '  case "all":\n';
        source += '    self.stopAll();\n';
        source += '    return;\n';
        source += '  case "this script":\n';
        source += '    endCall();\n';
        source += '    return;\n';
        source += '  case "other scripts in sprite":\n';
        source += '  case "other scripts in stage":\n';
        source += '    S.stopSoundsExcept(BASE);\n';
        source += '    for (var i = 0; i < self.queue.length; i++) {\n';
        source += '      if (i !== THREAD && self.queue[i] && self.queue[i].sprite === S) {\n';
        source += '        self.queue[i] = undefined;\n';
        source += '      }\n';
        source += '    }\n';
        source += '    break;\n';
        source += '}\n';

      } else if (block[0] === 'wait:elapsed:from:') {

        wait(num(block[1]));

      } else if (block[0] === 'warpSpeed') {

        source += 'WARP++;\n';
        seq(block[1]);
        source += 'WARP--;\n';

      } else if (block[0] === 'createCloneOf') {

        source += 'clone(' + val(block[1]) + ');\n';

      } else if (block[0] === 'deleteClone') {

        source += 'if (S.isClone) {\n';
        source += '  S.remove();\n';
        source += '  var i = self.children.indexOf(S);\n';
        source += '  if (i !== -1) self.children.splice(i, 1);\n';
        source += '  for (var i = 0; i < self.queue.length; i++) {\n';
        source += '    if (self.queue[i] && self.queue[i].sprite === S) {\n';
        source += '      self.queue[i] = undefined;\n';
        source += '    }\n';
        source += '  }\n';
        source += '  return;\n';
        source += '}\n';

      } else if (block[0] === 'doAsk') {

        source += 'R.id = self.nextPromptId++;\n';
        var id = label();
        source += 'if (self.promptId < R.id) {\n';
        forceQueue(id);
        source += '}\n';
        source += 'S.ask(' + val(block[1]) + ');\n';
        var id = label();
        source += 'if (self.promptId === R.id) {\n';
        forceQueue(id);
        source += '}\n';

      } else if (block[0] === 'timerReset') {

        source += 'self.timerStart = self.now();\n';

      } else {

        warn('Undefined command: ' + block[0]);

      }
    }
    var createContinuation = function(source) {
      var result = '(function() {\n';
      var brackets = 0;
      var delBrackets = 0;
      var shouldDelete = false;
      var here = 0;
      var length = source.length;
      while (here < length) {
        var i = source.indexOf('{', here);
        var j = source.indexOf('}', here);
        var k = source.indexOf('return;', here);
        if (k === -1)
          k = length;
        if (i === -1 && j === -1) {
          if (!shouldDelete) {
            result += source.slice(here, k);
          }
          break;
        }
        if (i === -1)
          i = length;
        if (j === -1)
          j = length;
        if (shouldDelete) {
          if (i < j) {
            delBrackets++;
            here = i + 1;
          } else {
            delBrackets--;
            if (!delBrackets) {
              shouldDelete = false;
            }
            here = j + 1;
          }
        } else {
          if (brackets === 0 && k < i && k < j) {
            result += source.slice(here, k);
            break;
          }
          if (i < j) {
            result += source.slice(here, i + 1);
            brackets++;
            here = i + 1;
          } else {
            result += source.slice(here, j);
            here = j + 1;
            if (source.substr(j, 8) === '} else {') {
              if (brackets > 0) {
                result += '} else {';
                here = j + 8;
              } else {
                shouldDelete = true;
                delBrackets = 0;
              }
            } else {
              if (brackets > 0) {
                result += '}';
                brackets--;
              }
            }
          }
        }
      }
      result += '})';
      return P.runtime.scopedEval(result);
    };
    warnings = {};
    var source = '';
    var startfn = object.fns.length;
    var fns = [0];
    if (script[0][0] === 'procDef') {
      var inputs = script[0][2];
      var types = script[0][1].match(/%[snmdcb]/g) || [];
      var used = [];
    }
    for (let i = 1; i < script.length; i++) {
      compile(script[i]);
    }
    if (script[0][0] === 'procDef') {
      let pre = '';
      for (let i = types.length; i--;) {
        if (used[i]) {
          const t = types[i];
          if (t === '%d' || t === '%n' || t === '%c') {
            pre += 'C.numargs[' + i + '] = +C.args[' + i + '] || 0;\n';
          }
          else if (t === '%b') {
            pre += 'C.boolargs[' + i + '] = bool(C.args[' + i + ']);\n';
          }
        }
      }
      source = pre + source;
      for (let i = 1, l = fns.length; i < l; ++i) {
        fns[i] += pre.length;
      }
      source += 'endCall();\n';
      source += 'return;\n';
    }
    for (let i = 0; i < fns.length; i++) {
      object.fns.push(createContinuation(source.slice(fns[i])));
    }
    var f = object.fns[startfn];
    if (script[0][0] === 'whenClicked') {
      object.listeners.whenClicked.push(f);
    } else if (script[0][0] === 'whenGreenFlag') {
      object.listeners.whenGreenFlag.push(f);
    } else if (script[0][0] === 'whenCloned') {
      object.listeners.whenCloned.push(f);
    } else if (script[0][0] === 'whenIReceive') { 
      var key = String(script[0][1]).toLowerCase();
      (object.listeners.whenIReceive[key] || (object.listeners.whenIReceive[key] = [])).push(f);
    } else if (script[0][0] === 'whenKeyPressed') {
      const key = P.runtime.getKeyCode(script[0][1]);
      object.addWhenKeyPressedHandler(key, f);
    } else if (script[0][0] === 'whenSceneStarts') {
      var key = String(script[0][1]).toLowerCase();
      (object.listeners.whenSceneStarts[key] || (object.listeners.whenSceneStarts[key] = [])).push(f);
    } else if (script[0][0] === 'procDef') {
      const warp = script[0][4];
      const name = script[0][1];
      if (!object.procedures[name]) {
        object.procedures[name] = new P.sb2.Scratch2Procedure(f, warp, inputs);
      } else {
        warn('procedure already exists: ' + name);
      }
    } else if (script[0][0] === 'whenSensorGreaterThan') {

    } else {
      warn('Undefined event: ' + script[0][0]);
    }
  }
  compiler_1.compile = function(stage) {
    compileScripts(stage);
    for (var i = 0; i < stage.children.length; i++) {
      if (!stage.children[i].cmd) {
        compileScripts(stage.children[i]);
      }
      for (var key in warnings) {
        console.warn(key + (warnings[key] > 1 ? ' (repeated ' + warnings[key] + ' times)' : ''));
      }
    }
  }

  return compiler_1;

}())
P.sb3.compiler = (function(){

  var compiler_1 = {};

  var createContinuation = function(source) {
    var result = '(function() {\n';
    var brackets = 0;
    var delBrackets = 0;
    var shouldDelete = false;
    var here = 0;
    var length = source.length;
    while (here < length) {
      var i = source.indexOf('{', here);
      var j = source.indexOf('}', here);
      var k = source.indexOf('return;', here);
      if (k === -1)
        k = length;
      if (i === -1 && j === -1) {
        if (!shouldDelete) {
          result += source.slice(here, k);
        }
        break;
      }
      if (i === -1)
        i = length;
      if (j === -1)
        j = length;
      if (shouldDelete) {
        if (i < j) {
          delBrackets++;
          here = i + 1;
        }
        else {
          delBrackets--;
          if (!delBrackets) {
            shouldDelete = false;
          }
          here = j + 1;
        }
      }
      else {
        if (brackets === 0 && k < i && k < j) {
          result += source.slice(here, k);
          break;
        }
        if (i < j) {
          result += source.slice(here, i + 1);
          brackets++;
          here = i + 1;
        }
        else {
          result += source.slice(here, j);
          here = j + 1;
          if (source.substr(j, 8) === '} else {') {
            if (brackets > 0) {
              result += '} else {';
              here = j + 8;
            }
            else {
              shouldDelete = true;
              delBrackets = 0;
            }
          }
          else {
            if (brackets > 0) {
              result += '}';
              brackets--;
            }
          }
        }
      }
    }
    result += '})';
    return P.runtime.scopedEval(result);
  }

  function assertNever(i) {
    throw new Error('Compile-time assertNever failed.');
  }

  class CompiledInput {
    constructor(source, type) {
      if (type == 'list') {
        this.source = 'contentsOfList(' + source + ')';
      } else {
        this.source = source;
      }
      this.type = type;
      this.potentialNumber = true;
      this.flags = 0;
    }
    enableFlag(flag) {
      this.flags |= flag;
    }
    hasFlag(flag) {
      return (this.flags & flag) !== 0;
    }
    toString() {
      return this.source;
    }
  }

  compiler_1.CompiledInput = CompiledInput;

  const stringInput = (v) => new CompiledInput(v, 'string');

  const numberInput = (v) => new CompiledInput(v, 'number');

  const booleanInput = (v) => new CompiledInput(v, 'boolean');

  const anyInput = (v) => new CompiledInput(v, 'any');
  
  class BlockUtil {

    constructor(compiler, block) {

      this.compiler = compiler;
      this.block = block;

    }

    get target() {

      return this.compiler.target;

    }

    get stage() {

      return this.compiler.target.stage;

    }

    getInput(name, type) {

      return this.compiler.compileInput(this.block, name, type);

    }

    getField(name) {

      return this.compiler.getField(this.block, name);

    }

    fieldInput(name) {

      return this.sanitizedInput(this.getField(name));

    }

    sanitizedInput(string) {

      return this.compiler.sanitizedInput(string);

    }

    sanitizedString(string) {

      return this.compiler.sanitizedString(string);

    }

    getVariableReference(field) {

      return this.compiler.getVariableReference(this.compiler.getVariableField(this.block, field));

    }

    getListReference(field) {

      return this.compiler.getListReference(this.compiler.getVariableField(this.block, field));

    }

    getVariableScope(field) {

      return this.compiler.findVariable(this.compiler.getVariableField(this.block, field)).scope;

    }

    isCloudVariable(field) {

      return this.target.stage.cloudVariables.indexOf(this.getField(field)) > -1;

    }

    getListScope(field) {

      return this.compiler.findList(this.compiler.getVariableField(this.block, field)).scope;

    }

    asType(input, type) {

      return this.compiler.asType(input, type);

    }

    evaluateInputOnce(input) {

      const fn = P.runtime.scopedEval(`(function() { return ${input}; })`);
      return this.target.stage.runtime.evaluateExpression(this.target, fn);

    }

  }

  compiler_1.BlockUtil = BlockUtil;

  class StatementUtil extends BlockUtil {

    constructor() {
      super(...arguments);
      this.content = '';
      this.substacksQueue = false;
    }

    getSubstack(name) {

      const labelsBefore = this.compiler.labelCount;
      const substack = this.compiler.compileSubstackInput(this.block, name);
      if (this.compiler.labelCount !== labelsBefore) {
        this.substacksQueue = true;
      }
      return substack;

    }

    claimNextLabel() {
      return this.compiler.labelCount++;
    }
    addLabel(label) {
      if (!label) {
        label = this.claimNextLabel();
      }
      this.write(`{{${label}}}`);
      return label;
    }

    queue(label) {
      this.writeLn(`queue(${label}); return;`);
    }

    forceQueue(label) {
      this.writeLn(`forceQueue(${label}); return;`);
    }

    visual(variant) {
      switch (variant) {

        case 'drawing':

          this.writeLn('if (S.visible || S.isPenDown) VISUAL = true;');

          break;

        case 'visible':

          this.writeLn('if (S.visible) VISUAL = true;');

          break;

        case 'always':

          this.writeLn('VISUAL = true;');

          break;

        default: assertNever(variant);

      }
    }

    updateBubble() {
      this.writeLn('if (S.saying) S.updateBubble()');
    }

    waitUntilSettles(source) {
      this.writeLn('save();');
      this.writeLn('R.resume = false;');
      this.writeLn('var localR = R;');
      this.writeLn(`${source}`);
      this.writeLn('  .then(function() { localR.resume = true; })');
      this.writeLn('  .catch(function() { localR.resume = true; });');
      const label = this.addLabel();
      this.writeLn('if (!R.resume) {');
      this.forceQueue(label);
      this.writeLn('}');
      this.writeLn('restore();');
    }

    waitOneTick() {
      this.writeLn('save();');
      this.writeLn('R.start = self.currentMSecs;');
      const label = this.addLabel();
      this.writeLn('if (self.currentMSecs === R.start) {');
      this.forceQueue(label);
      this.writeLn('}');
      this.writeLn('restore();');
    }

    write(content) {
      this.content += content;
    }

    writeLn(content) {
      this.content += content + '\n';
    }

  }

  compiler_1.StatementUtil = StatementUtil;

  class InputUtil extends BlockUtil {

    numberInput(v) { return numberInput(v); }
    stringInput(v) { return stringInput(v); }
    booleanInput(v) { return booleanInput(v); }
    anyInput(v) { return anyInput(v); }

  }

  compiler_1.InputUtil = InputUtil;

  class HatUtil extends BlockUtil {
    constructor(compiler, block, startingFunction) {
      super(compiler, block);
      this.startingFunction = startingFunction;
    }
  }

  compiler_1.HatUtil = HatUtil;
  compiler_1.statementLibrary = Object.create(null);
  compiler_1.inputLibrary = Object.create(null);
  compiler_1.hatLibrary = Object.create(null);
  compiler_1.watcherLibrary = Object.create(null);

  const safeNumberToString = (n) => {
    if (Object.is(n, -0)) {
        return '-0';
    }
    return n.toString();
  };

  class Compiler {

    constructor(target) {
      this.labelCount = 0;
      this.needsMusic = false;
      this.costumeAndSoundNames = new Set();
      this.target = target;
      this.data = target.sb3data;
      this.blocks = this.data.blocks;
      for (const costume of target.costumes) {
        this.costumeAndSoundNames.add(costume.name);
      }
      for (const sound of target.sounds) {
        this.costumeAndSoundNames.add(sound.name);
      }
    }

    getHatBlocks() {
      return Object.keys(this.blocks)
        .filter((i) => this.blocks[i].topLevel);
    }

    getStatementCompiler(opcode) {
      if (compiler_1.statementLibrary[opcode]) {
        return compiler_1.statementLibrary[opcode];
      }
      return null;
    }

    getInputCompiler(opcode) {
      if (compiler_1.inputLibrary[opcode]) {
        return compiler_1.inputLibrary[opcode];
      }
      return null;
    }

    getHatCompiler(opcode) {
      if (compiler_1.hatLibrary[opcode]) {
        return compiler_1.hatLibrary[opcode];
      }
      return null;
    }

    getInputFallback(type) {
      switch (type) {
        case 'number': return '0';
        case 'boolean': return 'false';
        case 'string': return '""';
        case 'any': return '""';
        case 'list': return '""';
        case 'color': return '0';
      }
      assertNever(type);
    }

    asType(input, type) {
      switch (type) {
        case 'string': return '("" + ' + input + ')';
        case 'number': return '(+' + input + ' || 0)';
        case 'boolean': return 'bool(' + input + ')';
        case 'any': return input;
        case 'list': throw new Error("Converting to 'list' type is not something you're supposed to do");
        case 'color': return 'parseColor(' + input + ')';
      }
      assertNever(type);
    }

    convertInputType(input, type) {
      if (input.type === type) {
        if (type === 'number' && input.hasFlag(1)) {
          return new CompiledInput(input.source, type);
        }
        return input;
      }
      if (type === 'any') {
        if (input.type === 'list') {
          type = 'string';
        }
        else {
          return input;
        }
      }
      return new CompiledInput(this.asType(input.source, type), type);
    }

    sanitizedInput(string) {
      return stringInput(this.sanitizedString(string));
    }

    sanitizedString(string) {
      string = string
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\\'')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\{/g, '\\x7b')
        .replace(/\}/g, '\\x7d');
      return `"${string}"`;
    }

    sanitizedComment(content) {
      content = content
        .replace(/\*\//g, '');
      return `/* ${content} */`;
    }

    findVariable(id) {
      const stage = this.target.stage;
      if (stage.varIds.hasOwnProperty(id)) {
        return { scope: 'self', name: stage.varIds[id] };
      } else if (this.target.varIds.hasOwnProperty(id)) {
        return { scope: 'S', name: this.target.varIds[id] };
      } else {
        this.target.vars[id] = 0;
        this.target.varIds[id] = id;
        return { scope: 'S', name: id };
      }
    }

    findList(id) {
      const stage = this.target.stage;
      if (stage.listIds.hasOwnProperty(id)) {
        return { scope: 'self', name: stage.listIds[id] };
      }
      else if (this.target.listIds.hasOwnProperty(id)) {
        return { scope: 'S', name: this.target.listIds[id] };
      }
      else {
        this.target.lists[id] = P.sb3.createList();
        this.target.listIds[id] = id;
        return { scope: 'S', name: id };
      }
    }

    getVariableReference(id) {
      const { scope, name } = this.findVariable(id);
      return `${scope}.vars[${this.sanitizedString(name)}]`;
    }

    getListReference(id) {
      const { scope, name } = this.findList(id);
      return `${scope}.lists[${this.sanitizedString(name)}]`;
    }

    isStringLiteralPotentialNumber(text) {
      return /\d|true|false|Infinity/.test(text);
    }

    isNameOfCostumeOrSound(text) {
      return this.costumeAndSoundNames.has(text);
    }

    compileNativeInput(native, desiredType) {
      const type = native[0];
      switch (type) {
        case 4:
        case 5:
        case 6:
        case 7:
        case 8: {
          const number = +native[1];
          if (isNaN(number) || desiredType === 'string') {
            return this.sanitizedInput('' + native[1]);
          }
          return numberInput(safeNumberToString(number));
        }
        case 10: {
          const value = native[1];
          if (desiredType !== 'string' && /\d|Infinity/.test(value) && !this.isNameOfCostumeOrSound(value)) {
            const number = +value;
            if (number.toString() === value) {
              if (!isNaN(number)) {
                return numberInput(number.toString());
              }
            }
          }
          const input = this.sanitizedInput(native[1] + '');
          input.potentialNumber = this.isStringLiteralPotentialNumber(native[1]);
          return input;
        }
        case 12:
          return anyInput(this.getVariableReference(native[2]));
        case 13:
          return new CompiledInput(this.getListReference(native[2]), 'list');
        case 11:
          return this.sanitizedInput(native[1]);
        case 9: {
          const color = native[1];
          const rgb = P.utils.parseColor(color);
          return new CompiledInput('' + rgb, 'color');
        }
        default:
          this.warn('unknown native', type, native);
          return stringInput('""');
      }
    }

    compileInput(parentBlock, inputName, type) {
      if (!parentBlock.inputs || !parentBlock.inputs[inputName]) {
        this.warn('missing input', inputName);
        return new CompiledInput(this.getInputFallback(type), type);
      }
      const input = parentBlock.inputs[inputName];
      if (Array.isArray(input[1])) {
        const native = input[1];
        return this.convertInputType(this.compileNativeInput(native, type), type);
      }
      const inputBlockId = input[1];
      if (!inputBlockId) {
        return new CompiledInput(this.getInputFallback(type), type);
      }
      const inputBlock = this.blocks[inputBlockId];
      if (!inputBlock) {
        return new CompiledInput(this.getInputFallback(type), type);
      }
      const opcode = inputBlock.opcode;
      const compiler = this.getInputCompiler(opcode);
      if (!compiler) {
        this.warn('unknown input', opcode, inputBlock);
        return new CompiledInput(this.getInputFallback(type), type);
      }
      const util = new InputUtil(this, inputBlock);
      let result = compiler(util);
      return this.convertInputType(result, type);
    }

    getField(block, fieldName) {
      const value = block.fields[fieldName];
      if (!value) {
        this.warn('missing field', fieldName);
        return '';
      }
      return '' + value[0];
    }

    getVariableField(block, fieldName) {
      const value = block.fields[fieldName];
      if (!value) {
        this.warn('missing variable field', fieldName);
        return '';
      }
      return '' + value[1];
    }

    compileSubstackInput(block, substackName) {
      if (!block.inputs[substackName]) {
        return '';
      }
      const substack = block.inputs[substackName];
      const type = substack[0];
      const id = substack[1];
      if (id === null) {
        return '';
      }
      return this.compileStack(id);
    }

    getNewState() {
      return {
        isWarp: false,
        isProcedure: false,
        argumentNames: []
      };
    }

    compileStack(startingBlock) {
      let script = '';
      let block = this.blocks[startingBlock];
      while (true) {
        var opcode = block.opcode;
        const compiler = this.getStatementCompiler(opcode);
        if (false) {
          script += this.sanitizedComment(block.opcode);
        }
        if (compiler) {
          const util = new StatementUtil(this, block);
          compiler(util);
          script += util.content;
        }
        else {
          script += '/* unknown statement */';
          this.warn('unknown statement', opcode, block);
        }
        if (!block.next) {
          break;
        }
        block = this.blocks[block.next];
      }
      return script;
    }

    compileHat(hat) {
      const hatCompiler = this.getHatCompiler(hat.opcode);
      if (!hatCompiler) {
        if (!this.getInputCompiler(hat.opcode) && !this.getStatementCompiler(hat.opcode)) {
          this.warn('unknown hat block', hat.opcode, hat);
        }
        return;
      }
      this.labelCount = this.target.fns.length;
      const startingBlock = hat.next;
      if (!startingBlock) {
        return;
      }
      this.state = this.getNewState();
      let script = `{{${this.labelCount++}}}`;
      if (hatCompiler.precompile) {
        script += hatCompiler.precompile(this, hat);
      }
      script += this.compileStack(startingBlock);
      if (hatCompiler.postcompile) {
        script = hatCompiler.postcompile(this, script, hat);
      }
      const parseResult = this.parseScript(script);
      const parsedScript = parseResult.script;
      const startFn = this.target.fns.length;
      for (let label of Object.keys(parseResult.labels)) {
        this.target.fns[label] = createContinuation(parsedScript.slice(parseResult.labels[label]));//P
      }
      const startingFunction = this.target.fns[startFn];
      const util = new HatUtil(this, hat, startingFunction);
      hatCompiler.handle(util);
      if (false) {
        this.log(`[${this.target.name}] compiled sb3 script "${hat.opcode}"`, script, this.target);
      }
    }

    parseScript(script) {
      const labels = {};
      let index = 0;
      let accumulator = 0;
      while (true) {
        const labelStart = script.indexOf('{{', index);
        if (labelStart === -1) {
          break;
        }
        const labelEnd = script.indexOf('}}', index);
        const id = script.substring(labelStart + 2, labelEnd);
        const length = labelEnd + 2 - labelStart;
        accumulator += length;
        labels[id] = labelEnd + 2 - accumulator;
        index = labelEnd + 2;
      }
      const fixedScript = script.replace(/{{\d+}}/g, '');
      return {
        labels,
        script: fixedScript,
      };
    }

    warn(...args) {
      args.unshift(`[sb3 compiler ${this.target.name}]`);
      console.warn.apply(console, args);
    }

    log(...args) {
      args.unshift(`[sb3 compiler ${this.target.name}]`);
      console.log.apply(console, args);
    }

    compile() {
      try {
        const hats = this.getHatBlocks();
        for (const hatId of hats) {
          const hat = this.blocks[hatId];
          this.compileHat(hat);
        }
      } catch(error) {
        console.warn('wee cannot start compile in sb3',error)
      }
      this.target.sb3data = null;
    }

  }

  compiler_1.Compiler = Compiler;
  return compiler_1;

}());
(function () {

  const statementLibrary = P.sb3.compiler.statementLibrary;
  const inputLibrary = P.sb3.compiler.inputLibrary;
  const hatLibrary = P.sb3.compiler.hatLibrary;
  const watcherLibrary = P.sb3.compiler.watcherLibrary;

  statementLibrary['control_all_at_once'] = function (util) {

    const SUBSTACK = util.getSubstack('SUBSTACK');
    util.write(SUBSTACK);

  };

  statementLibrary['control_clear_counter'] = function (util) {
    util.writeLn('self.counter = 0;');

  };

  statementLibrary['control_create_clone_of'] = function (util) {

    const CLONE_OPTION = util.getInput('CLONE_OPTION', 'any');
    util.writeLn(`clone(${CLONE_OPTION});`);

  };

  statementLibrary['control_delete_this_clone'] = function (util) {

    util.writeLn('if (S.isClone) {');
    util.visual('visible');
    util.writeLn('  S.remove();');
    util.writeLn('  var i = self.children.indexOf(S);');
    util.writeLn('  if (i !== -1) self.children.splice(i, 1);');
    util.writeLn('  for (var i = 0; i < self.queue.length; i++) {');
    util.writeLn('    if (self.queue[i] && self.queue[i].sprite === S) {');
    util.writeLn('      self.queue[i] = undefined;');
    util.writeLn('    }');
    util.writeLn('  }');
    util.writeLn('  return;');
    util.writeLn('}');

  };

  statementLibrary['control_for_each'] = function (util) {

    const VARIABLE = util.getVariableReference('VARIABLE');
    const SUBSTACK = util.getSubstack('SUBSTACK');
    const VALUE = util.getInput('VALUE', 'number');
    util.writeLn('save();');
    util.writeLn(`R.times = ${VALUE};`);
    util.writeLn('R.current = 0;');
    const label = util.addLabel();
    util.writeLn(`if (R.current < R.times) {`);
    util.writeLn(`  ${VARIABLE} = ++R.current;`);
    util.write(SUBSTACK);
    util.queue(label);
    util.writeLn('} else {');
    util.writeLn('  restore();');
    util.writeLn('}');

  };

  statementLibrary['control_forever'] = function (util) {

    const SUBSTACK = util.getSubstack('SUBSTACK');

    if (util.compiler.state.isWarp && !util.substacksQueue) {

      util.writeLn('while (true) {');
      util.write(SUBSTACK);
      util.writeLn('}');

    } else {

      const label = util.addLabel();
      util.write(SUBSTACK);
      util.queue(label);

    }

  };

  statementLibrary['control_if'] = function (util) {

    const CONDITION = util.getInput('CONDITION', 'boolean');
    const SUBSTACK = util.getSubstack('SUBSTACK');
    util.writeLn(`if (${CONDITION}) {`);
    util.write(SUBSTACK);
    util.writeLn('}');

  };
  statementLibrary['control_if_else'] = function (util) {

    const CONDITION = util.getInput('CONDITION', 'boolean');
    const SUBSTACK = util.getSubstack('SUBSTACK');
    const SUBSTACK2 = util.getSubstack('SUBSTACK2');
    util.writeLn(`if (${CONDITION}) {`);
    util.write(SUBSTACK);
    util.writeLn('} else {');
    util.write(SUBSTACK2);
    util.writeLn('}');

  };

  statementLibrary['control_incr_counter'] = function (util) {

    util.writeLn('self.counter++;');

  };

  statementLibrary['control_repeat'] = function (util) {

    const TIMES = util.getInput('TIMES', 'any');
    const SUBSTACK = util.getSubstack('SUBSTACK');
    if (util.compiler.state.isWarp && !util.substacksQueue) {
      util.writeLn('save();');
      util.writeLn(`R.count = ${TIMES};`);
      util.writeLn('while (R.count >= 0.5) {');
      util.writeLn('  R.count -= 1;');
      util.write(SUBSTACK);
      util.writeLn('}');
      util.writeLn('restore();');
    } else {
      util.writeLn('save();');
      util.writeLn(`R.count = ${TIMES};`);
      const label = util.addLabel();
      util.writeLn('if (R.count >= 0.5) {');
      util.writeLn('  R.count -= 1;');
      util.write(SUBSTACK);
      util.queue(label);
      util.writeLn('} else {');
      util.writeLn('  restore();');
      util.writeLn('}');
    }

  };

  statementLibrary['control_repeat_until'] = function (util) {

    const CONDITION = util.getInput('CONDITION', 'boolean');
    const SUBSTACK = util.getSubstack('SUBSTACK');
    if (util.compiler.state.isWarp && !util.substacksQueue) {
      util.writeLn(`while (!${CONDITION}) {`);
      util.write(SUBSTACK);
      util.writeLn('}');
    }
    else {
      const label = util.addLabel();
      util.writeLn(`if (!${CONDITION}) {`);
      util.write(SUBSTACK);
      util.queue(label);
      util.writeLn('}');
    }

  };

  statementLibrary['control_stop'] = function (util) {

    const STOP_OPTION = util.getField('STOP_OPTION');
    switch (STOP_OPTION) {
      case 'all':
        util.writeLn('self.stopped = true; return;');
        break;
      case 'this script':
        util.writeLn('endCall(); return;');
        break;
      case 'other scripts in sprite':
      case 'other scripts in stage':
        util.writeLn('S.stopSoundsExcept(BASE);');
        util.writeLn('for (var i = 0; i < self.queue.length; i++) {');
        util.writeLn('  if (i !== THREAD && self.queue[i] && self.queue[i].sprite === S) {');
        util.writeLn('    self.queue[i] = undefined;');
        util.writeLn('  }');
        util.writeLn('}');
        break;
    }

  };

  statementLibrary['control_wait'] = function (util) {

    const DURATION = util.getInput('DURATION', 'any');
    util.visual('always');
    util.writeLn('save();');
    util.writeLn('R.start = self.currentMSecs;');
    util.writeLn(`R.duration = ${DURATION};`);
    util.writeLn(`var first = true;`);
    const label = util.addLabel();
    util.writeLn('if (self.currentMSecs - R.start < R.duration * 1000 || first) {');
    util.writeLn('  var first;');
    util.forceQueue(label);
    util.writeLn('}');
    util.writeLn('restore();');

  };

  statementLibrary['control_wait_until'] = function (util) {

    const CONDITION = util.getInput('CONDITION', 'boolean');
    const label = util.addLabel();
    util.writeLn(`if (!${CONDITION}) {`);
    util.forceQueue(label);
    util.writeLn('}');

  };

  statementLibrary['control_while'] = function (util) {

    const CONDITION = util.getInput('CONDITION', 'boolean');
    const SUBSTACK = util.getSubstack('SUBSTACK');
    if (util.compiler.state.isWarp && !util.substacksQueue) {
      util.writeLn(`while (${CONDITION}) {`);
      util.write(SUBSTACK);
      util.writeLn('}');
    } else {
      const label = util.addLabel();
      util.writeLn(`if (${CONDITION}) {`);
      util.write(SUBSTACK);
      util.queue(label);
      util.writeLn('}');
    }

  };

  statementLibrary['data_addtolist'] = function (util) {

    const LIST = util.getListReference('LIST');
    const ITEM = util.getInput('ITEM', 'any');
    util.writeLn(`watchedAppendToList(${LIST}, ${ITEM});`);

  };

  statementLibrary['data_changevariableby'] = function (util) {

    const VARIABLE = util.getVariableReference('VARIABLE');
    const VALUE = util.getInput('VALUE', 'number');
    util.writeLn(`${VARIABLE} = (${util.asType(VARIABLE, 'number')} + ${VALUE});`);

    if (util.isCloudVariable('VARIABLE')) {

      util.writeLn(`cloudVariableChanged(${util.sanitizedString(util.getField('VARIABLE'))})`);

    }

  };

  statementLibrary['data_deletealloflist'] = function (util) {

    const LIST = util.getListReference('LIST');
    util.writeLn(`watchedDeleteAllOfList(${LIST});`);

  };

  statementLibrary['data_deleteoflist'] = function (util) {

    const LIST = util.getListReference('LIST');
    const INDEX = util.getInput('INDEX', 'any');
    util.writeLn(`watchedDeleteLineOfList(${LIST}, ${INDEX});`);

  };

  statementLibrary['data_hidelist'] = function (util) {

    const LIST = util.sanitizedString(util.getField('LIST'));
    const scope = util.getListScope('LIST');
    util.writeLn(`${scope}.showList(${LIST}, false);`);

  };

  statementLibrary['data_hidevariable'] = function (util) {

    const VARIABLE = util.sanitizedString(util.getField('VARIABLE'));
    const scope = util.getVariableScope('VARIABLE');
    util.writeLn(`${scope}.showVariable(${VARIABLE}, false);`);

  };

  statementLibrary['data_insertatlist'] = function (util) {

    const LIST = util.getListReference('LIST');
    const INDEX = util.getInput('INDEX', 'any');
    const ITEM = util.getInput('ITEM', 'any');
    util.writeLn(`watchedInsertInList(${LIST}, ${INDEX}, ${ITEM});`);

  };

  statementLibrary['data_replaceitemoflist'] = function (util) {

    const LIST = util.getListReference('LIST');
    const ITEM = util.getInput('ITEM', 'any');
    const INDEX = util.getInput('INDEX', 'any');
    util.writeLn(`watchedSetLineOfList(${LIST}, ${INDEX}, ${ITEM});`);

  };

  statementLibrary['data_setvariableto'] = function (util) {

    const VARIABLE = util.getVariableReference('VARIABLE');
    const VALUE = util.getInput('VALUE', 'any');
    util.writeLn(`${VARIABLE} = ${VALUE};`);

    if (util.isCloudVariable('VARIABLE')) {
      util.writeLn(`cloudVariableChanged(${util.sanitizedString(util.getField('VARIABLE'))})`);
    }

  };

  statementLibrary['data_showlist'] = function (util) {

    const LIST = util.sanitizedString(util.getField('LIST'));
    const scope = util.getListScope('LIST');
    util.writeLn(`${scope}.showList(${LIST}, true);`);

  };

  statementLibrary['data_showvariable'] = function (util) {

    const VARIABLE = util.sanitizedString(util.getField('VARIABLE'));
    const scope = util.getVariableScope('VARIABLE');
    util.writeLn(`${scope}.showVariable(${VARIABLE}, true);`);

  };

  statementLibrary['event_broadcast'] = function (util) {

    const BROADCAST_INPUT = util.getInput('BROADCAST_INPUT', 'any');

    util.writeLn(`var threads = broadcast(${BROADCAST_INPUT});`);
    util.writeLn('if (threads.code.indexOf(BASERETURN.code) !== -1) {return;}');

  };

  statementLibrary['event_broadcastandwait'] = function (util) {

    const BROADCAST_INPUT = util.getInput('BROADCAST_INPUT', 'any');
    util.writeLn('save();');
    util.writeLn(`R.threads = broadcast(${BROADCAST_INPUT});`);
    util.writeLn('if (R.threads.code.indexOf(BASERETURN.code) !== -1) {return;}');
    const label = util.addLabel();
    util.writeLn('if (running(R.threads)) {');
    util.forceQueue(label);
    util.writeLn('}');
    util.writeLn('restore();');

  };

  statementLibrary['looks_changeeffectby'] = function (util) {

    const EFFECT = util.sanitizedString(util.getField('EFFECT')).toLowerCase();
    const CHANGE = util.getInput('CHANGE', 'number');
    util.writeLn(`S.changeFilter(${EFFECT}, ${CHANGE});`);
    util.visual('visible');

  };

  statementLibrary['looks_changesizeby'] = function (util) {

    const CHANGE = util.getInput('CHANGE', 'any');
    util.writeLn(`var f = S.scale + ${CHANGE} / 100;`);
    util.writeLn('S.scale = f < 0 ? 0 : f;');
    util.visual('visible');

  };

  statementLibrary['looks_cleargraphiceffects'] = function (util) {

    util.writeLn('S.resetFilters();');
    util.visual('visible');

  };

  statementLibrary['looks_goforwardbackwardlayers'] = function (util) {

    const FORWARD_BACKWARD = util.getField('FORWARD_BACKWARD');
    const NUM = util.getInput('NUM', 'number');
    util.writeLn('var i2 = self.children.length;');
    util.writeLn('var i = self.children.indexOf(S);');
    util.writeLn('if (i !== -1 && (' + NUM + ' !== 0)) {');
    util.writeLn('  self.children.splice(i, 1);');

    if (FORWARD_BACKWARD === 'forward') {
      util.writeLn(`  self.children.splice(Math.max(0, Math.min(i2 - 1, i + (${NUM} | 0))), 0, S);`);
    } else {
      util.writeLn(`  self.children.splice(Math.max(0, Math.min(i2 - 1, i - (${NUM} | 0))), 0, S);`);
    }

    util.writeLn('}');

  };

  statementLibrary['looks_gotofrontback'] = function (util) {

    const FRONT_BACK = util.getField('FRONT_BACK');
    util.writeLn('var i = self.children.indexOf(S);');
    util.writeLn('if (i !== -1) self.children.splice(i, 1);');
    if (FRONT_BACK === 'front') {
      util.writeLn('self.children.push(S);');
    } else {
      util.writeLn('self.children.unshift(S);');
    }

  };
  statementLibrary['looks_hide'] = function (util) {

    util.visual('visible');
    util.writeLn('S.visible = false;');
    util.updateBubble();

  };

  statementLibrary['looks_nextbackdrop'] = function (util) {

    util.writeLn('self.showNextCostume();');
    util.visual('always');
    util.writeLn('var threads = sceneChange();');
    util.writeLn('if (threads.code.indexOf(BASERETURN.code) !== -1) {return;}');

  };

  statementLibrary['looks_nextcostume'] = function (util) {

    util.writeLn('S.showNextCostume();');
    util.visual('visible');

  };

  statementLibrary['looks_say'] = function (util) {

    const MESSAGE = util.getInput('MESSAGE', 'any');
    util.writeLn(`S.say(${MESSAGE}, false);`);
    util.visual('visible');

  };

  statementLibrary['looks_sayforsecs'] = function (util) {

    const MESSAGE = util.getInput('MESSAGE', 'any');
    const SECS = util.getInput('SECS', 'number');
    util.writeLn('save();');
    util.writeLn(`R.id = S.say(${MESSAGE}, false);`);
    util.visual('visible');
    util.writeLn('R.start = self.now();');
    util.writeLn(`R.duration = ${SECS};`);
    const label = util.addLabel();
    util.writeLn('if (self.now() - R.start < R.duration * 1000) {');
    util.forceQueue(label);
    util.writeLn('}');
    util.writeLn('if (S.sayId === R.id) {');
    util.writeLn('  S.say("");');
    util.writeLn('}');
    util.writeLn('restore();');

  };

  statementLibrary['looks_seteffectto'] = function (util) {

    const EFFECT = util.sanitizedString(util.getField('EFFECT')).toLowerCase();
    const VALUE = util.getInput('VALUE', 'number');
    util.writeLn(`S.setFilter(${EFFECT}, ${VALUE});`);
    util.visual('visible');

  };

  statementLibrary['looks_setsizeto'] = function (util) {

    const SIZE = util.getInput('SIZE', 'number');
    util.writeLn(`S.scale = Math.max(0, ${SIZE} / 100);`);
    util.visual('visible');

  };

  statementLibrary['looks_show'] = function (util) {

    util.writeLn('S.visible = true;');
    util.visual('always');
    util.updateBubble();

  };

  statementLibrary['looks_switchbackdropto'] = function (util) {

    const BACKDROP = util.getInput('BACKDROP', 'any');
    util.writeLn(`self.setCostume(${BACKDROP});`);
    util.visual('always');
    util.writeLn('var threads = sceneChange();');
    util.writeLn('if (threads.code.indexOf(BASERETURN.code) !== -1) {return;}');

  };

  statementLibrary['looks_switchbackdroptoandwait'] = function (util) {

    const BACKDROP = util.getInput('BACKDROP', 'any');
    util.writeLn(`self.setCostume(${BACKDROP});`);
    util.visual('always');
    util.writeLn('save();');
    util.writeLn('R.threads = sceneChange();');
    util.writeLn('if (R.threads.code.indexOf(BASERETURN.code) !== -1) {return;}');
    const label = util.addLabel();
    util.writeLn('if (running(R.threads)) {');
    util.forceQueue(label);
    util.writeLn('}');
    util.writeLn('restore();');

  };

  statementLibrary['looks_switchcostumeto'] = function (util) {

    const COSTUME = util.getInput('COSTUME', 'any');
    util.writeLn(`S.setCostume(${COSTUME});`);
    util.visual('visible');

  };

  statementLibrary['looks_think'] = function (util) {

    const MESSAGE = util.getInput('MESSAGE', 'any');
    util.writeLn(`S.say(${MESSAGE}, true);`);
    util.visual('visible');

  };

  statementLibrary['looks_thinkforsecs'] = function (util) {

    const MESSAGE = util.getInput('MESSAGE', 'any');
    const SECS = util.getInput('SECS', 'number');
    util.writeLn('save();');
    util.writeLn(`R.id = S.say(${MESSAGE}, true);`);
    util.visual('visible');
    util.writeLn('R.start = self.now();');
    util.writeLn(`R.duration = ${SECS};`);
    const label = util.addLabel();

    util.writeLn('if (self.now() - R.start < R.duration * 1000) {');
    util.forceQueue(label);
    util.writeLn('}');
    util.writeLn('if (S.sayId === R.id) {');
    util.writeLn('  S.say("");');
    util.writeLn('}');
    util.writeLn('restore();');

  };

  statementLibrary['motion_changexby'] = function (util) {

    const DX = util.getInput('DX', 'number');
    util.writeLn(`S.moveTo(S.scratchX + ${DX}, S.scratchY);`);
    util.visual('drawing');

  };

  statementLibrary['motion_changeyby'] = function (util) {

    const DY = util.getInput('DY', 'number');
    util.writeLn(`S.moveTo(S.scratchX, S.scratchY + ${DY});`);
    util.visual('drawing');

  };

  statementLibrary['motion_glidesecstoxy'] = function (util) {

    const SECS = util.getInput('SECS', 'any');
    const X = util.getInput('X', 'any');
    const Y = util.getInput('Y', 'any');
    util.visual('drawing');
    util.writeLn('save();');
    util.writeLn('R.start = self.now();');
    util.writeLn(`R.duration = ${SECS};`);
    util.writeLn('R.baseX = S.scratchX;');
    util.writeLn('R.baseY = S.scratchY;');
    util.writeLn(`R.deltaX = ${X} - S.scratchX;`);
    util.writeLn(`R.deltaY = ${Y} - S.scratchY;`);
    const label = util.addLabel();

    util.writeLn('var f = (self.now() - R.start) / (R.duration * 1000);');
    util.writeLn('if (f > 1 || isNaN(f)) f = 1;');
    util.writeLn('S.moveTo(R.baseX + f * R.deltaX, R.baseY + f * R.deltaY);');
    util.visual('drawing');

    util.writeLn('if (f < 1) {');
    util.forceQueue(label);
    util.writeLn('}');
    util.writeLn('restore();');

  };

  statementLibrary['motion_glideto'] = function (util) {

    const SECS = util.getInput('SECS', 'any');
    const TO = util.getInput('TO', 'any');
    util.visual('drawing');
    util.writeLn('save();');
    util.writeLn('R.start = self.now();');
    util.writeLn(`R.duration = ${SECS};`);
    util.writeLn('R.baseX = S.scratchX;');
    util.writeLn('R.baseY = S.scratchY;');
    util.writeLn(`var to = self.getPosition(${TO});`);
    util.writeLn('if (to) {');
    util.writeLn('  R.deltaX = to.x - S.scratchX;');
    util.writeLn('  R.deltaY = to.y - S.scratchY;');
    const label = util.addLabel();

    util.writeLn('  var f = (self.now() - R.start) / (R.duration * 1000);');
    util.writeLn('  if (f > 1 || isNaN(f)) f = 1;');
    util.writeLn('  S.moveTo(R.baseX + f * R.deltaX, R.baseY + f * R.deltaY);');
    util.visual('drawing');

    util.writeLn('  if (f < 1) {');
    util.forceQueue(label);
    util.writeLn('  }');
    util.writeLn('  restore();');
    util.writeLn('}');

  };

  statementLibrary['motion_goto'] = function (util) {

    const TO = util.getInput('TO', 'any');
    util.writeLn(`S.gotoObject(${TO});`);
    util.visual('drawing');

  };

  statementLibrary['motion_gotoxy'] = function (util) {
    const X = util.getInput('X', 'number');
    const Y = util.getInput('Y', 'number');
    util.writeLn(`S.moveTo(${X}, ${Y});`);
    util.visual('drawing');

  };

  statementLibrary['motion_ifonedgebounce'] = function (util) {

    util.writeLn('S.bounceOffEdge();');

  };

  statementLibrary['motion_movesteps'] = function (util) {

    const STEPS = util.getInput('STEPS', 'number');
    util.writeLn(`S.forward(${STEPS});`);
    util.visual('drawing');

  };

  statementLibrary['motion_pointindirection'] = function (util) {

    const DIRECTION = util.getInput('DIRECTION', 'number');
    util.visual('visible');
    util.writeLn(`S.setDirection(${DIRECTION});`);

  };

  statementLibrary['motion_pointtowards'] = function (util) {

    const TOWARDS = util.getInput('TOWARDS', 'any');
    util.writeLn(`S.pointTowards(${TOWARDS});`);
    util.visual('visible');

  };

  statementLibrary['motion_setrotationstyle'] = function (util) {

    const STYLE = P.utils.parseRotationStyle(util.getField('STYLE'));
    util.writeLn(`S.rotationStyle = ${STYLE};`);
    util.visual('visible');

  };

  statementLibrary['motion_setx'] = function (util) {

    const X = util.getInput('X', 'number');
    util.writeLn(`S.moveTo(${X}, S.scratchY);`);
    util.visual('drawing');

  };

  statementLibrary['motion_sety'] = function (util) {

    const Y = util.getInput('Y', 'number');
    util.writeLn(`S.moveTo(S.scratchX, ${Y});`);
    util.visual('drawing');

  };

  statementLibrary['motion_turnleft'] = function (util) {

    const DEGREES = util.getInput('DEGREES', 'number');
    util.writeLn(`S.setDirection(S.direction - ${DEGREES});`);
    util.visual('visible');

  };

  statementLibrary['motion_turnright'] = function (util) {

    const DEGREES = util.getInput('DEGREES', 'number');
    util.writeLn(`S.setDirection(S.direction + ${DEGREES});`);
    util.visual('visible');

  };

  statementLibrary['music_changeTempo'] = function (util) {

    const TEMPO = util.getInput('TEMPO', 'number');
    util.writeLn(`self.tempoBPM += ${TEMPO};`);

  };
  statementLibrary['music_playDrumForBeats'] = function (util) {

    const BEATS = util.getInput('BEATS', 'number');
    const DRUM = util.getInput('DRUM', 'number');

    util.compiler.needsMusic = true;
    util.writeLn('save();');
    util.writeLn('R.start = self.now();');
    util.writeLn(`R.duration = ${BEATS} * 60 / self.tempoBPM;`);
    util.writeLn(`var first = true;`);

    if (P.audioContext) {
      util.writeLn(`R.sound = playDrum(Math.round(${DRUM}) - 1 || 0, 60, ${BEATS} * 60 / self.tempoBPM);`);
    } else {
      util.writeLn('R.sound = { stopped: false };');
    }

    const id = util.addLabel();
    util.writeLn('S.activeSounds.add(R.sound);');
    util.writeLn('if ((self.now() - R.start < R.duration * 1000 || first) && !R.sound.stopped) {');

    util.writeLn('  var first;');
    util.forceQueue(id);
    util.writeLn('}');
    util.writeLn('S.activeSounds.delete(R.sound);');
    util.writeLn('restore();');

  };

  statementLibrary['music_playNoteForBeats'] = function (util) {

    const BEATS = util.getInput('BEATS', 'number');
    const NOTE = util.getInput('NOTE', 'number');
    util.compiler.needsMusic = true;
    util.writeLn('save();');
    util.writeLn('R.start = self.now();');
    util.writeLn(`R.duration = ${BEATS} * 60 / self.tempoBPM;`);
    util.writeLn(`var first = true;`);

    if (P.audioContext) {
      util.writeLn(`R.sound = playNote(${NOTE}, R.duration);`);
    } else {
      util.writeLn('R.sound = { stopped: false };');
    }

    const id = util.addLabel();

    util.writeLn('S.activeSounds.add(R.sound);');
    util.writeLn('if ((self.now() - R.start < R.duration * 1000 || first) && !R.sound.stopped) {');
    util.writeLn('  var first;');
    util.forceQueue(id);
    util.writeLn('}');
    util.writeLn('S.activeSounds.delete(R.sound);');
    util.writeLn('restore();');

  };

  statementLibrary['music_restForBeats'] = function (util) {

    const BEATS = util.getInput('BEATS', 'number');
    util.writeLn('save();');
    util.writeLn('R.start = self.now();');
    util.writeLn(`R.duration = ${BEATS} * 60 / self.tempoBPM;`);
    util.writeLn(`var first = true;`);
    const id = util.addLabel();

    util.writeLn('if (self.now() - R.start < R.duration * 1000 || first) {');
    util.writeLn('  var first;');
    util.forceQueue(id);
    util.writeLn('}');
    util.writeLn('restore();');

  };
  statementLibrary['music_setTempo'] = function (util) {

    const TEMPO = util.getInput('TEMPO', 'number');
    util.writeLn(`self.tempoBPM = ${TEMPO};`);

  };

  statementLibrary['music_setInstrument'] = function (util) {

    const INSTRUMENT = util.getInput('INSTRUMENT', 'number');
    util.writeLn(`S.instrument = Math.max(0, Math.min(21 - 1, ${INSTRUMENT} - 1)) | 0;`);

  };

  statementLibrary['music_midiSetInstrument'] = function (util) {

    const INSTRUMENT = util.getInput('INSTRUMENT', 'number');
    util.writeLn(`S.instrument = MIDI_INSTRUMENTS[Math.max(0, Math.min(128 - 1, ${INSTRUMENT} - 1)) | 0] - 1;`);

  };

  statementLibrary['music_midiPlayDrumForBeats'] = function (util) {

    const BEATS = util.getInput('BEATS', 'number');
    const DRUM = util.getInput('DRUM', 'number');
    util.compiler.needsMusic = true;
    util.writeLn('save();');
    util.writeLn('R.start = self.now();');
    util.writeLn(`R.duration = ${BEATS} * 60 / self.tempoBPM;`);
    util.writeLn(`var first = true;`);


    if (P.audioContext) {
      util.writeLn(`R.sound = playDrum(Math.round(${DRUM}) - 1 || 0, 60, ${BEATS} * 60 / self.tempoBPM, true);`);
    } else {
      util.writeLn('R.sound = { stopped: false };');
    }

    util.writeLn('R.sound.isNote = true;');
    const id = util.addLabel();

    util.writeLn('S.activeSounds.add(R.sound);');
    util.writeLn('if ((self.now() - R.start < R.duration * 1000 || first) && !R.sound.stopped) {');
    util.writeLn('  var first;');
    util.forceQueue(id);
    util.writeLn('}');

    util.writeLn('S.activeSounds.delete(R.sound);');
    util.writeLn('restore();');

  };
  statementLibrary['pen_changePenColorParamBy'] = function (util) {

    const COLOR_PARAM = util.getInput('COLOR_PARAM', 'string');
    const VALUE = util.getInput('VALUE', 'number');
    util.writeLn(`S.penColor.changeParam(${COLOR_PARAM}, ${VALUE});`);

  };

  statementLibrary['pen_changePenHueBy'] = function (util) {

    const HUE = util.getInput('HUE', 'number');
    util.writeLn('S.penColor.toHSLA();');
    util.writeLn(`S.penColor.x += ${HUE} * 360 / 200;`);
    util.writeLn('S.penColor.y = 100;');

  };

  statementLibrary['pen_changePenShadeBy'] = function (util) {

    const SHADE = util.getInput('SHADE', 'number');
    util.writeLn('S.penColor.toHSLA();');
    util.writeLn(`S.penColor.z = (S.penColor.z + ${SHADE}) % 200;`);
    util.writeLn('if (S.penColor.z < 0) S.penColor.z += 200;');
    util.writeLn('S.penColor.y = 100;');

  };

  statementLibrary['pen_changePenSizeBy'] = function (util) {

    const SIZE = util.getInput('SIZE', 'number');
    util.writeLn(`S.penSize = Math.max(1, S.penSize + ${SIZE});`);

  };

  statementLibrary['pen_clear'] = function (util) {

    util.writeLn('self.clearPen();');
    util.visual('always');

  };
  statementLibrary['pen_penDown'] = function (util) {

    util.writeLn('S.isPenDown = true;');
    util.writeLn('S.dotPen();');
    util.visual('always');

  };

  statementLibrary['pen_penUp'] = function (util) {

    util.writeLn('S.isPenDown = false;');

  };

  statementLibrary['pen_setPenColorParamTo'] = function (util) {

    const COLOR_PARAM = util.getInput('COLOR_PARAM', 'string');
    const VALUE = util.getInput('VALUE', 'number');
    util.writeLn(`S.penColor.setParam(${COLOR_PARAM}, ${VALUE});`);

  };

  statementLibrary['pen_setPenColorToColor'] = function (util) {

    const COLOR = util.getInput('COLOR', 'color');
    util.writeLn(`S.penColor.setShiftedRGBA(${COLOR});`);

  };

  statementLibrary['pen_setPenHueToNumber'] = function (util) {

    const HUE = util.getInput('HUE', 'number');
    util.writeLn('S.penColor.toHSLA();');
    util.writeLn(`S.penColor.x = ${HUE} * 360 / 200;`);
    util.writeLn('S.penColor.y = 100;');
    util.writeLn('S.penColor.a = 1;');

  };

  statementLibrary['pen_setPenShadeToNumber'] = function (util) {

    const SHADE = util.getInput('SHADE', 'number');
    util.writeLn('S.penColor.toHSLA();');
    util.writeLn(`S.penColor.z = ${SHADE} % 200;`);
    util.writeLn('if (S.penColor.z < 0) S.penColor.z += 200;');
    util.writeLn('S.penColor.y = 100;');

  };

  statementLibrary['pen_setPenSizeTo'] = function (util) {

    const SIZE = util.getInput('SIZE', 'number');
    util.writeLn(`S.penSize = Math.max(1, Math.min(${SIZE}, 1200));`);

  };

  statementLibrary['pen_stamp'] = function (util) {

    util.writeLn('S.stamp();');
    util.visual('always');

  };

  statementLibrary['procedures_call'] = function (util) {

    const mutation = util.block.mutation;
    const name = mutation.proccode;
    const label = util.claimNextLabel();
    util.write(`call(S.procedures[${util.sanitizedString(name)}], ${label}, [`);

    const inputNames = JSON.parse(mutation.argumentids);

    for (const inputName of inputNames) {
      util.write(`${util.getInput(inputName, 'any')}, `);
    }

    util.writeLn(']); return;');
    util.addLabel(label);

  };

  statementLibrary['sound_changeeffectby'] = function (util) {

    const EFFECT = util.sanitizedString(util.getField('EFFECT'));
    const VALUE = util.getInput('VALUE', 'number');
    util.writeLn(`S.changeSoundFilter(${EFFECT}, ${VALUE});`);
    util.writeLn('if (updateSoundEffectsOnAllSounds) updateSoundEffectsOnAllSounds();');
    util.waitOneTick();

  };

  statementLibrary['sound_changevolumeby'] = function (util) {

    const VOLUME = util.getInput('VOLUME', 'number');
    util.writeLn(`S.volume = Math.max(0, Math.min(1, S.volume + ${VOLUME} / 100));`);
    util.writeLn('if (S.node) S.node.gain.value = S.volume;');
    util.waitOneTick();

  };

  statementLibrary['sound_cleareffects'] = function (util) {

    util.writeLn('S.resetSoundFilters();');

  };

  statementLibrary['sound_play'] = function (util) {

    const SOUND_MENU = util.getInput('SOUND_MENU', 'any');

    if (P.audioContext) {
      util.writeLn(`var sound = S.getSound(${SOUND_MENU});`);
      util.writeLn('if (sound) startSound(sound);');
    }

  };

  statementLibrary['sound_playuntildone'] = function (util) {

    const SOUND_MENU = util.getInput('SOUND_MENU', 'any');

    if (P.audioContext) {

      util.writeLn(`var sound = S.getSound(${SOUND_MENU});`);
      util.writeLn('if (sound) {');
      util.writeLn('  save();');
      util.writeLn('  R.sound = playSound(sound);');
      util.writeLn('  S.activeSounds.add(R.sound);');
      const label = util.addLabel();
      util.writeLn('  if (!R.sound.node.ended && !R.sound.stopped) {');
      util.forceQueue(label);
      util.writeLn('  }');
      util.writeLn('  S.activeSounds.delete(R.sound);');
      util.writeLn('  restore();');
      util.writeLn('}');

    }

  };

  statementLibrary['sound_seteffectto'] = function (util) {

    const EFFECT = util.sanitizedString(util.getField('EFFECT'));
    const VALUE = util.getInput('VALUE', 'number');
    util.writeLn(`S.setSoundFilter(${EFFECT}, ${VALUE});`);
    util.writeLn('if (updateSoundEffectsOnAllSounds) updateSoundEffectsOnAllSounds();');
    util.writeLn('if (!self.removeLimits) {');
    util.waitOneTick();
    util.writeLn('}');

  };

  statementLibrary['sound_setvolumeto'] = function (util) {

    const VOLUME = util.getInput('VOLUME', 'number');

    util.writeLn(`S.volume = Math.max(0, Math.min(1, ${VOLUME} / 100));`);
    util.writeLn('if (S.node) S.node.gain.value = S.volume;');
    util.writeLn('if (!self.removeLimits) {');
    util.waitOneTick();
    util.writeLn('}');

  };

  statementLibrary['sound_stopallsounds'] = function (util) {

    if (P.audioContext) {
      util.writeLn('self.stopAllSounds();');
    }

  };

  statementLibrary['sensing_askandwait'] = function (util) {

    const QUESTION = util.getInput('QUESTION', 'string');
    util.writeLn('R.id = self.nextPromptId++;');
    const label1 = util.addLabel();
    util.writeLn('if (self.promptId < R.id) {');
    util.forceQueue(label1);
    util.writeLn('}');
    util.writeLn(`S.ask(${QUESTION});`);
    const label2 = util.addLabel();
    util.writeLn('if (self.promptId === R.id) {');
    util.forceQueue(label2);
    util.writeLn('}');
    util.writeLn('S.say("");');
    util.visual('always');

  };

  statementLibrary['sensing_resettimer'] = function (util) {

    util.writeLn('self.resetTimer();');

  };

  statementLibrary['sensing_setdragmode'] = function (util) {

    const DRAG_MODE = util.getField('DRAG_MODE');

    if (DRAG_MODE === 'draggable') {
      util.writeLn('S.isDraggable = true;');
    } else {
      util.writeLn('S.isDraggable = false;');
    }

  };

  statementLibrary['text2speech_setVoice'] = function (util) {

    const VOICE = util.getInput('VOICE', 'string');
    util.stage.initTextToSpeech();
    util.writeLn(`self.tts.setVoice(${VOICE});`);

  };
  statementLibrary['text2speech_setLanguage'] = function (util) {

    const LANGUAGE = util.getInput('LANGUAGE', 'string');
    util.stage.initTextToSpeech();
    util.writeLn(`self.tts.setLanguage(${LANGUAGE});`);

  };
  statementLibrary['text2speech_speakAndWait'] = function (util) {

    const WORDS = util.getInput('WORDS', 'string');
    util.stage.initTextToSpeech();
    util.waitUntilSettles(`self.tts.speak(${WORDS})`);

  };

  statementLibrary['videoSensing_videoToggle'] = function (util) {

    const VIDEO_STATE = util.getInput('VIDEO_STATE', 'string');

    util.writeLn(`switch (${VIDEO_STATE}) {`);
    util.writeLn('  case "off": self.showVideo(false,false); break;');
    util.writeLn('  case "on": self.showVideo(true,false); break;');
    util.writeLn('  case "on-flipped": self.showVideo(true,true); break;');
    util.writeLn('}');

  };

  statementLibrary['videoSensing_setVideoTransparency'] = function (util) {

    const VIDEO_STATE = util.getInput('TRANSPARENCY', 'number');
    util.writeLn(`self.setVideoTransparency(1 - ${VIDEO_STATE} / 100);`);

  };

  const noopStatement = (util) => util.writeLn('/* noop */');

  statementLibrary['motion_align_scene'] = noopStatement;
  statementLibrary['motion_scroll_right'] = noopStatement;
  statementLibrary['motion_scroll_up'] = noopStatement;
  statementLibrary['looks_changestretchby'] = noopStatement;
  statementLibrary['looks_hideallsprites'] = noopStatement;
  statementLibrary['looks_setstretchto'] = noopStatement;

  inputLibrary['argument_reporter_boolean'] = function (util) {

    const VALUE = util.getField('VALUE');

    if (!util.compiler.state.isProcedure || util.compiler.state.argumentNames.indexOf(VALUE) === -1) {
      const lowerCaseName = VALUE.toLowerCase();

      if (lowerCaseName === 'is compiled?' || lowerCaseName === 'is forkphorus?') {
        return util.booleanInput('true');
      }

      return util.numberInput('0');

    }

    return util.booleanInput(util.asType(`C.args[${util.sanitizedString(VALUE)}]`, 'boolean'));

  };
  inputLibrary['argument_reporter_string_number'] = function (util) {

    const VALUE = util.getField('VALUE');

    if (!util.compiler.state.isProcedure || util.compiler.state.argumentNames.indexOf(VALUE) === -1) {
      return util.numberInput('0');
    }

    return util.anyInput(`C.args[${util.sanitizedString(VALUE)}]`);

  };
  inputLibrary['control_create_clone_of_menu'] = function (util) {

    return util.fieldInput('CLONE_OPTION');

  };

  inputLibrary['control_get_counter'] = function (util) {

    return util.numberInput('self.counter');

  };

  inputLibrary['data_itemoflist'] = function (util) {

    const LIST = util.getListReference('LIST');
    const INDEX = util.getInput('INDEX', 'any');
    return util.anyInput(`getLineOfList(${LIST}, ${INDEX})`);

  };

  inputLibrary['data_itemnumoflist'] = function (util) {

    const LIST = util.getListReference('LIST');
    const ITEM = util.getInput('ITEM', 'any');
    return util.numberInput(`listIndexOf(${LIST}, ${ITEM})`);

  };

  inputLibrary['data_lengthoflist'] = function (util) {

    const LIST = util.getListReference('LIST');
    return util.numberInput(`${LIST}.length`);

  };

  inputLibrary['data_listcontainsitem'] = function (util) {

    const LIST = util.getListReference('LIST');
    const ITEM = util.getInput('ITEM', 'any');
    return util.booleanInput(`listContains(${LIST}, ${ITEM})`);

  };

  inputLibrary['looks_backdropnumbername'] = function (util) {

    const NUMBER_NAME = util.getField('NUMBER_NAME');

    if (NUMBER_NAME === 'number') {
      return util.numberInput('(self.currentCostumeIndex + 1)');
    } else {
      return util.stringInput('self.costumes[self.currentCostumeIndex].name');
    }

  };

  inputLibrary['looks_backdrops'] = function (util) {

    return util.fieldInput('BACKDROP');

  };

  inputLibrary['looks_costume'] = function (util) {

    return util.fieldInput('COSTUME');

  };

  inputLibrary['looks_costumenumbername'] = function (util) {

    const NUMBER_NAME = util.getField('NUMBER_NAME');

    if (NUMBER_NAME === 'number') {
      return util.numberInput('(S.currentCostumeIndex + 1)');
    } else {
      return util.stringInput('S.costumes[S.currentCostumeIndex].name');
    }

  };

  inputLibrary['looks_size'] = function (util) {

    return util.numberInput('Math.round(S.scale * 100)');

  };

  inputLibrary['makeymakey_menu_KEY'] = function (util) {

    return util.fieldInput('KEY');

  };

  inputLibrary['makeymakey_menu_SEQUENCE'] = function (util) {

    return util.fieldInput('SEQUENCE');

  };

  inputLibrary['matrix'] = function (util) {

    return util.fieldInput('MATRIX');

  };

  inputLibrary['motion_direction'] = function (util) {

    return util.numberInput('S.direction');

  };

  inputLibrary['motion_glideto_menu'] = function (util) {

    return util.fieldInput('TO');

  };

  inputLibrary['motion_goto_menu'] = function (util) {

    return util.fieldInput('TO');

  };

  inputLibrary['motion_pointtowards_menu'] = function (util) {

    return util.fieldInput('TOWARDS');

  };

  inputLibrary['motion_xposition'] = function (util) {

    return util.numberInput('S.scratchX');

  };

  inputLibrary['motion_yposition'] = function (util) {

    return util.numberInput('S.scratchY');

  };

  inputLibrary['music_getTempo'] = function (util) {

    return util.numberInput('self.tempoBPM');

  };

  inputLibrary['music_menu_DRUM'] = function (util) {

    return util.fieldInput('DRUM');

  };

  inputLibrary['music_menu_INSTRUMENT'] = function (util) {

    return util.fieldInput('INSTRUMENT');

  };

  inputLibrary['note'] = function (util) {

    return util.fieldInput('NOTE');

  };

  inputLibrary['operator_add'] = function (util) {

    const NUM1 = util.getInput('NUM1', 'number');
    const NUM2 = util.getInput('NUM2', 'number');
    return util.numberInput(`(CastEngine.toNumber(${NUM1}) + CastEngine.toNumber(${NUM2}))`);

  };
  inputLibrary['operator_and'] = function (util) {

    const OPERAND1 = util.getInput('OPERAND1', 'any');
    const OPERAND2 = util.getInput('OPERAND2', 'any');

    return util.booleanInput(`(CastEngine.toBoolean(${OPERAND1}) && CastEngine.toBoolean(${OPERAND2}))`);

  };

  inputLibrary['operator_contains'] = function (util) {

    const STRING1 = util.getInput('STRING1', 'string');
    const STRING2 = util.getInput('STRING2', 'string');

    return util.booleanInput(`stringContains(${STRING1}, ${STRING2})`);

  };

  inputLibrary['operator_divide'] = function (util) {

    const NUM1 = util.getInput('NUM1', 'number');
    const NUM2 = util.getInput('NUM2', 'number');

    const input = util.numberInput(`(CastEngine.toNumber(${NUM1}) / CastEngine.toNumber(${NUM2}))`);
    input.enableFlag(1);
    return input;

  };

  inputLibrary['operator_equals'] = function (util) {

    const OPERAND1 = util.getInput('OPERAND1', 'any');
    const OPERAND2 = util.getInput('OPERAND2', 'any');
    return util.booleanInput(`equal(${OPERAND1}, ${OPERAND2})`);

  };

  inputLibrary['operator_gt'] = function (util) {

    const OPERAND1 = util.getInput('OPERAND1', 'any');
    const OPERAND2 = util.getInput('OPERAND2', 'any');

    return util.booleanInput(`(compare(${OPERAND1}, ${OPERAND2}) === 1)`);

  };
  inputLibrary['operator_join'] = function (util) {

    const STRING1 = util.getInput('STRING1', 'string');
    const STRING2 = util.getInput('STRING2', 'string');

    return util.stringInput(`('' + ${STRING1} + ${STRING2})`);

  };
  inputLibrary['operator_length'] = function (util) {

    const STRING = util.getInput('STRING', 'string');
    return util.numberInput(`('' + ${STRING}).length`);

  };
  inputLibrary['operator_letter_of'] = function (util) {

    const STRING = util.getInput('STRING', 'string');
    const LETTER = util.getInput('LETTER', 'number');

    return util.stringInput(`((${STRING})[(${LETTER} | 0) - 1] || "")`);

  };
  inputLibrary['operator_lt'] = function (util) {

    const OPERAND1 = util.getInput('OPERAND1', 'any');
    const OPERAND2 = util.getInput('OPERAND2', 'any');

    return util.booleanInput(`(compare(${OPERAND1}, ${OPERAND2}) === -1)`);

  };
  inputLibrary['operator_mathop'] = function (util) {

    const OPERATOR = util.getField('OPERATOR');
    const NUM = util.getInput('NUM', 'number');

    return util.numberInput(`mathFunc('${OPERATOR}', ${NUM})`);

  };

  inputLibrary['operator_mod'] = function (util) {

    const NUM1 = util.getInput('NUM1', 'number');
    const NUM2 = util.getInput('NUM2', 'number');

    return util.numberInput(`mod(${NUM1}, ${NUM2})`);

  };

  inputLibrary['operator_multiply'] = function (util) {

    const NUM1 = util.getInput('NUM1', 'number');
    const NUM2 = util.getInput('NUM2', 'number');

    return util.numberInput(`(CastEngine.toNumber(${NUM1}) * CastEngine.toNumber(${NUM2}))`);

  };

  inputLibrary['operator_not'] = function (util) {

    const OPERAND = util.getInput('OPERAND', 'any');
    return util.booleanInput(`!CastEngine.toBoolean(${OPERAND})`);

  };

  inputLibrary['operator_or'] = function (util) {
    const OPERAND1 = util.getInput('OPERAND1', 'any');
    const OPERAND2 = util.getInput('OPERAND2', 'any');

    return util.booleanInput(`(CastEngine.toBoolean(${OPERAND1}) || CastEngine.toBoolean(${OPERAND2}))`);

  };

  inputLibrary['operator_random'] = function (util) {

    const FROM = util.getInput('FROM', 'string');
    const TO = util.getInput('TO', 'string');

    return util.numberInput(`random(${FROM}, ${TO})`);

  };
  inputLibrary['operator_round'] = function (util) {

    const NUM = util.getInput('NUM', 'number');
    return util.numberInput(`Math.round(${NUM})`);

  };
  inputLibrary['operator_subtract'] = function (util) {

    const NUM1 = util.getInput('NUM1', 'number');
    const NUM2 = util.getInput('NUM2', 'number');

    return util.numberInput(`(CastEngine.toNumber(${NUM1}) - CastEngine.toNumber(${NUM2}))`);

  };

  inputLibrary['pen_menu_colorParam'] = function (util) {

    return util.fieldInput('colorParam');

  };

  inputLibrary['sensing_answer'] = function (util) {

    return util.stringInput('self.answer');

  };

  inputLibrary['sensing_coloristouchingcolor'] = function (util) {

    const COLOR = util.getInput('COLOR', 'color');
    const COLOR2 = util.getInput('COLOR2', 'color');

    return util.booleanInput(`S.colorTouchingColor(${COLOR}, ${COLOR2})`);

  };

  inputLibrary['sensing_current'] = function (util) {

    const CURRENTMENU = util.getField('CURRENTMENU').toLowerCase();

    switch (CURRENTMENU) {

      case 'year': return util.numberInput('new Date().getFullYear()');
      case 'month': return util.numberInput('(new Date().getMonth() + 1)');
      case 'date': return util.numberInput('new Date().getDate()');
      case 'dayofweek': return util.numberInput('(new Date().getDay() + 1)');
      case 'hour': return util.numberInput('new Date().getHours()');
      case 'minute': return util.numberInput('new Date().getMinutes()');
      case 'second': return util.numberInput('new Date().getSeconds()');

    }

    return util.numberInput('0');
  };

  inputLibrary['sensing_dayssince2000'] = function (util) {

    return util.numberInput('((Date.now() - epoch) / 86400000)');

  };

  inputLibrary['sensing_distanceto'] = function (util) {

    const DISTANCETOMENU = util.getInput('DISTANCETOMENU', 'any');
    return util.numberInput(`S.distanceTo(${DISTANCETOMENU})`);

  };

  inputLibrary['sensing_distancetomenu'] = function (util) {

    return util.fieldInput('DISTANCETOMENU');

  };

  inputLibrary['sensing_keyoptions'] = function (util) {

    return util.fieldInput('KEY_OPTION');

  };

  inputLibrary['sensing_keypressed'] = function (util) {

    const KEY_OPTION = util.getInput('KEY_OPTION', 'string');
    return util.booleanInput(`!!self.keys[getKeyCode3(${KEY_OPTION})]`);

  };

  inputLibrary['sensing_loud'] = function (util) {

    util.stage.initMicrophone();
    return util.booleanInput('(self.microphone.getLoudness() > 10)');

  };

  inputLibrary['sensing_loudness'] = function (util) {

    util.stage.initMicrophone();
    return util.numberInput('self.microphone.getLoudness()');

  };

  inputLibrary['sensing_mousedown'] = function (util) {

    return util.booleanInput('self.mousePressed');

  };

  inputLibrary['sensing_mousex'] = function (util) {

    return util.numberInput('self.mouseX');

  };

  inputLibrary['sensing_mousey'] = function (util) {

    return util.numberInput('self.mouseY');

  };

  inputLibrary['sensing_of'] = function (util) {

    const PROPERTY = util.sanitizedString(util.getField('PROPERTY'));
    const OBJECT = util.getInput('OBJECT', 'string');

    return util.anyInput(`attribute(${PROPERTY}, ${OBJECT})`);

  };

  inputLibrary['sensing_of_object_menu'] = function (util) {

    return util.fieldInput('OBJECT');

  };

  inputLibrary['sensing_timer'] = function (util) {

    return util.numberInput('((self.now() - self.timerStart) / 1000)');

  };

  inputLibrary['sensing_touchingcolor'] = function (util) {

    const COLOR = util.getInput('COLOR', 'color');
    return util.booleanInput(`S.touchingColor(${COLOR})`);

  };

  inputLibrary['sensing_touchingobject'] = function (util) {

    const TOUCHINGOBJECTMENU = util.getInput('TOUCHINGOBJECTMENU', 'string');
    return util.booleanInput(`S.touching(${TOUCHINGOBJECTMENU})`);

  };

  inputLibrary['sensing_touchingobjectmenu'] = function (util) {

    return util.fieldInput('TOUCHINGOBJECTMENU');

  };

  inputLibrary['sound_sounds_menu'] = function (util) {

    return util.fieldInput('SOUND_MENU');

  };

  inputLibrary['sensing_username'] = function (util) {

    return util.stringInput('self.username');

  };

  inputLibrary['sound_volume'] = function (util) {

    return util.numberInput('(S.volume * 100)');

  };

  inputLibrary['text2speech_menu_voices'] = function (util) {

    return util.fieldInput('voices');

  };

  inputLibrary['text2speech_menu_languages'] = function (util) {

    return util.fieldInput('languages');

  };

  inputLibrary['translate_menu_languages'] = function (util) {

    return util.fieldInput('languages');

  };

  inputLibrary['translate_getTranslate'] = function (util) {

    const WORDS = util.getInput('WORDS', 'string');
    const LANGUAGE = util.getInput('LANGUAGE', 'string');

    return WORDS;

  };

  inputLibrary['translate_getViewerLanguage'] = function (util) {

    return util.sanitizedInput('English');

  };

  inputLibrary['videoSensing_menu_VIDEO_STATE'] = function (util) {

    return util.fieldInput('VIDEO_STATE');

  };

  const noopInput = (util) => util.anyInput('undefined');

  inputLibrary['motion_yscroll'] = noopInput;
  inputLibrary['motion_xscroll'] = noopInput;
  inputLibrary['sensing_userid'] = noopInput;

  hatLibrary['control_start_as_clone'] = {

    handle(util) {

      util.target.listeners.whenCloned.push(util.startingFunction);

    },

  };

  hatLibrary['event_whenbackdropswitchesto'] = {

    handle(util) {

      const BACKDROP = util.getField('BACKDROP').toLowerCase();

      if (!util.target.listeners.whenSceneStarts[BACKDROP]) {
        util.target.listeners.whenSceneStarts[BACKDROP] = [];
      }
      util.target.listeners.whenSceneStarts[BACKDROP].push(util.startingFunction);

    },

  };

  hatLibrary['event_whenbroadcastreceived'] = {

    handle(util) {

      const BROADCAST_OPTION = util.getField('BROADCAST_OPTION').toLowerCase();

      if (!util.target.listeners.whenIReceive[BROADCAST_OPTION]) {
        util.target.listeners.whenIReceive[BROADCAST_OPTION] = [];
      }

      util.target.listeners.whenIReceive[BROADCAST_OPTION].push(util.startingFunction);

    },

  };

  hatLibrary['event_whenflagclicked'] = {

    handle(util) {

      util.target.listeners.whenGreenFlag.push(util.startingFunction);

    },

  };
  hatLibrary['event_whengreaterthan'] = {

    precompile(compiler, hat) {

      const WHENGREATERTHANMENU = compiler.getField(hat, 'WHENGREATERTHANMENU');
      const VALUE = compiler.compileInput(hat, 'VALUE', 'number');

      let executeWhen = 'false';
      let stallUntil = 'false';

      switch (WHENGREATERTHANMENU.toLowerCase()) {

        case 'timer':

          executeWhen = `(self.whenTimerMSecs - self.timerStart) / 1000 > ${VALUE}`;
          stallUntil = `(self.whenTimerMSecs - self.timerStart) / 1000 <= ${VALUE}`;
          break;

        case 'loudness':

          compiler.target.stage.initMicrophone();
          executeWhen = `self.microphone.getLoudness() > ${VALUE}`;
          stallUntil = `self.microphone.getLoudness() <= ${VALUE}`;
          break;

        default:

          console.warn('unknown WHENGREATERTHANMENU', WHENGREATERTHANMENU);

      }

      let source = '';

      source += 'if (!R.init) { R.init = true; R.stalled = false; }\n';
      source += `if (R.stalled && (${stallUntil})) { R.stalled = false; }\n`;
      source += `else if (!R.stalled && (${executeWhen})) { R.stalled = true;\n`;

      return source;

    },

    postcompile(compiler, source, hat) {

      source += '}\n';
      source += `forceQueue(${compiler.target.fns.length});`;
      return source;

    },

    handle(util) {

      util.target.listeners.edgeActivated.push(util.startingFunction);

    },

  };

  hatLibrary['event_whenkeypressed'] = {

    handle(util) {

      const KEY_OPTION = util.getField('KEY_OPTION');
      const key = P.runtime.getKeyCode(KEY_OPTION);

      util.target.addWhenKeyPressedHandler(key, util.startingFunction);

    },

  };

  hatLibrary['event_whenstageclicked'] = {

    handle(util) {

      util.target.listeners.whenClicked.push(util.startingFunction);

    },

  };

  hatLibrary['event_whenthisspriteclicked'] = {

    handle(util) {

      util.target.listeners.whenClicked.push(util.startingFunction);

    },

  };

  function makeymakeyParseKey(key) {

    key = key.toLowerCase();

    if (key === 'up' || key === 'down' || key === 'left' || key === 'right') {

      return P.runtime.getKeyCode(key + ' arrow');

    }

    return P.runtime.getKeyCode(key);

  }

  hatLibrary['makeymakey_whenMakeyKeyPressed'] = {

    handle(util) {
      const KEY = util.getInput('KEY', 'string');

      try {

        const keyValue = '' + util.evaluateInputOnce(KEY);
        if (typeof keyValue !== 'string')
          throw new Error('cannot accept type: ' + typeof keyValue);
        var keyCode = makeymakeyParseKey(keyValue);

      } catch (e) {

        util.compiler.warn('makeymakey key generation error', e);
        return;

      }

      const key = P.runtime.getKeyCode(keyCode);
      util.target.addWhenKeyPressedHandler(key, util.startingFunction);

    },

  };

  hatLibrary['procedures_definition'] = {

    handle(util) {

      if (util.block.inputs.custom_block) {

        const customBlockId = util.block.inputs.custom_block[1];
        const mutation = util.compiler.blocks[customBlockId].mutation;
        const proccode = mutation.proccode;

        if (!util.target.procedures[proccode]) {

          const warp = typeof mutation.warp === 'string' ? mutation.warp === 'true' : mutation.warp;
          const argumentNames = JSON.parse(mutation.argumentnames);
          const procedure = new P.sb3.Scratch3Procedure(util.startingFunction, warp, argumentNames);

          util.target.procedures[proccode] = procedure;

        }

      }

    },

    postcompile(compiler, source, hat) {

      return source + 'endCall(); return;\n';

    },

    precompile(compiler, hat) {

      if (hat.inputs.custom_block) {

        const customBlockId = hat.inputs.custom_block[1];
        const mutation = compiler.blocks[customBlockId].mutation;
        const warp = typeof mutation.warp === 'string' ? mutation.warp === 'true' : mutation.warp;
        const argumentNames = JSON.parse(mutation.argumentnames);

        compiler.state.isProcedure = true;
        compiler.state.argumentNames = argumentNames;

        if (warp) {

          compiler.state.isWarp = true;

        }

      }

      return '';

    },

  };

  watcherLibrary['data_variable'] = {

    init(watcher) {

      const name = watcher.params.VARIABLE;
      watcher.target.watchers[name] = watcher;

    },

    set(watcher, value) {

      const name = watcher.params.VARIABLE;
      watcher.target.vars[name] = value;

    },

    evaluate(watcher) {

      const name = watcher.params.VARIABLE;
      return watcher.target.vars[name];

    },

    getLabel(watcher) {

      return watcher.params.VARIABLE;
    },

  };

  watcherLibrary['looks_backdropnumbername'] = {

    evaluate(watcher) {
      const target = watcher.stage;
      const param = watcher.params.NUMBER_NAME;
      if (param === 'number') {
        return target.currentCostumeIndex + 1;
      }
      else {
        return target.costumes[target.currentCostumeIndex].name;
      }
    },

    getLabel(watcher) {
      return 'backdrop ' + watcher.params.NUMBER_NAME;
    },

  };

  watcherLibrary['looks_costumenumbername'] = {

    evaluate(watcher) {

      const target = watcher.target;
      const param = watcher.params.NUMBER_NAME;

      if (param === 'number') {
        return target.currentCostumeIndex + 1;
      } else {
        return target.costumes[target.currentCostumeIndex].name;
      }

    },

    getLabel(watcher) {

      return 'costume ' + watcher.params.NUMBER_NAME;

    },

  };

  watcherLibrary['looks_size'] = {

    evaluate(watcher) { return watcher.target.isSprite ? watcher.target.scale * 100 : 100; },
    getLabel() { return 'size'; },

  };

  watcherLibrary['motion_direction'] = {

    evaluate(watcher) { return watcher.target.isSprite ? watcher.target.direction : 0; },
    getLabel() { return 'direction'; },

  };

  watcherLibrary['motion_xposition'] = {

    evaluate(watcher) { return watcher.target.scratchX; },
    getLabel() { return 'x position'; },

  };

  watcherLibrary['motion_yposition'] = {

    evaluate(watcher) { return watcher.target.scratchY; },
    getLabel() { return 'y position'; },

  };

  watcherLibrary['music_getTempo'] = {

    evaluate(watcher) { return watcher.stage.tempoBPM; },
    getLabel() { return 'Music: tempo'; },

  };
  watcherLibrary['sensing_answer'] = {

    evaluate(watcher) { return watcher.stage.answer; },
    getLabel() { return 'answer'; },

  };
  watcherLibrary['sensing_current'] = {

    evaluate(watcher) {

      const param = watcher.params.CURRENTMENU.toLowerCase();

      switch (param) {

        case 'year': return new Date().getFullYear();

        case 'month': return new Date().getMonth() + 1;

        case 'date': return new Date().getDate();

        case 'dayofweek': return new Date().getDay() + 1;

        case 'hour': return new Date().getHours();

        case 'minute': return new Date().getMinutes();

        case 'second': return new Date().getSeconds();

      }

      return 0;
    },

    getLabel(watcher) {

      const param = watcher.params.CURRENTMENU.toLowerCase();

      if (param === 'dayofweek') {
        return 'day of week';
      }

      return param;

    }

  };

  watcherLibrary['sensing_loudness'] = {

    init(watcher) {

      watcher.stage.initMicrophone();

    },

    evaluate(watcher) {

      if (watcher.stage.microphone) {

        return watcher.stage.microphone.getLoudness();

      } else {

        return -1;

      }

    },

    getLabel() { return 'loudness'; },

  };

  watcherLibrary['sensing_timer'] = {

    evaluate(watcher) {

      return (watcher.stage.now() - watcher.stage.timerStart) / 1000;

    },

    getLabel() { return 'timer'; },

  };

  watcherLibrary['sensing_username'] = {

    evaluate(watcher) { return watcher.stage.username; },
    getLabel() { return 'username'; },

  };

  watcherLibrary['sound_volume'] = {

    evaluate(watcher) { return watcher.target.volume * 100; },
    getLabel() { return 'volume'; },

  };

}());
P.ext = (function(){

  class Extension {

    constructor(stage) {

      this.stage = stage;

    }

    destroy() {

    }

    onstart() {

    }

    onpause() {

    }

    update() {

    }

  }

  var cloud = (function(Extension){

    const UPDATE_INTERVAL = 1000 / 15;

    function getAllCloudVariables(stage) {

      const result = {};

      for (const variable of stage.cloudVariables) {

        result[variable] = stage.vars[variable];

      }

      return result;

    }

    function isCloudDataMessage(data) {

      if (typeof data !== 'object' || !data) {
        return false;
      }

      return typeof data.method === 'string';

    }
    function isCloudSetMessage(data) {

      return isCloudDataMessage(data) &&
        typeof data.name === 'string' &&
        typeof data.value !== 'undefined';

    }

    class WebSocketCloudHandler extends Extension {

      constructor(stage, host, id) {

        super(stage);
        this.host = host;
        this.id = id;
        this.ws = null;
        this.queuedVariableChanges = [];
        this.updateInterval = null;
        this.reconnectTimeout = null;
        this.shouldReconnect = true;
        this.failures = 0;
        this.logPrefix = '[cloud-ws ' + host + ']';
        this.username = this.stage.username;
        this.interfaceStatusIndicator = document.createElement('div');
        this.interfaceStatusIndicator.className = 'phosphorus-cloud-status-indicator';
        this.interfaceStatusIndicator.style.display = 'none';
        stage.ui.appendChild(this.interfaceStatusIndicator);
        this.handleUpdateInterval = this.handleUpdateInterval.bind(this);
        this.connect();

      }

      variableChanged(name) {

        if (this.queuedVariableChanges.indexOf(name) > -1) {

          return;

        }

        this.queuedVariableChanges.push(name);

        if (this.updateInterval === null) {

          this.handleUpdateInterval();
          this.startUpdateInterval();

        }

      }

      handleUpdateInterval() {
        if (this.queuedVariableChanges.length === 0) {

          this.stopUpdateInterval();
          return;

        }

        if (this.ws === null || this.ws.readyState !== this.ws.OPEN || this.ws.bufferedAmount > 16384) {

          return;

        }

        const variableName = this.queuedVariableChanges.shift();
        const value = this.getVariable(variableName);
        
        this.send({

          method: 'set',
          name: variableName,
          value: value,

        });

      }

      send(data) {

        if (!this.ws)
          return;

        this.ws.send(JSON.stringify(data));

      }
      getVariable(name) {

        return this.stage.vars[name];
      }

      setVariable(name, value) {

        this.stage.vars[name] = value;

      }

      terminateConnection(code = 1000) {

        if (this.ws !== null) {

          this.ws.close(code);
          this.ws = null;

        }

      }

      connect() {

        if (this.ws !== null) {

          throw new Error('already connected');

        }

        this.setStatusText('Connecting...');
        console.log(this.logPrefix, 'connecting');
        this.ws = new WebSocket(this.host);
        this.shouldReconnect = true;

        this.ws.onopen = () => {

          console.log(this.logPrefix, 'connected');
          this.setStatusText('Connected');
          this.setStatusVisible(false);
          this.failures = 0;

          this.send({

            method: 'handshake',
            project_id: this.id,
            user: this.username

          });

        };

        this.ws.onmessage = (e) => {

          try {

            const lines = e.data.split('\n');

            for (const line of lines) {

              const data = JSON.parse(line);
              this.handleMessage(data);

            }

            if (!this.stage.isRunning) {

              this.stage.draw();

            }

          } catch (err) {

            console.warn('error parsing cloud server message', e.data, err);

          }

        };
        this.ws.onclose = (e) => {

          const code = e.code;
          this.ws = null;

          console.warn(this.logPrefix, 'closed', code);

          if (code === 4002) {

            this.setStatusText('Username is invalid. Change your username to connect.');
            console.error(this.logPrefix, 'error: Username');

          } else {

            this.reconnect();

          }

        };

        this.ws.onerror = (e) => {

          console.warn(this.logPrefix, 'error', e);

        };

      }
      reconnect() {

        if (!this.shouldReconnect) {

          return;

        }

        this.terminateConnection();

        if (this.reconnectTimeout) {

          clearTimeout(this.reconnectTimeout);

        } else {

          this.failures++;

        }

        this.setStatusText('Connection lost, reconnecting...');
        const delayTime = 2 ** this.failures * 1000 * Math.random();
        console.log(this.logPrefix, 'reconnecting in', delayTime);

        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.connect();
        }, delayTime);

      }

      disconnect() {

        console.log(this.logPrefix, 'disconnecting');
        this.shouldReconnect = false;
        this.terminateConnection();

      }
      handleMessage(data) {

        if (!isCloudSetMessage(data)) {

          return;
        }

        const { name: variableName, value } = data;
        if (this.stage.cloudVariables.indexOf(variableName) === -1) {
          throw new Error('invalid variable name');
        }
        this.setVariable(variableName, value);

      }

      startUpdateInterval() {

        if (this.updateInterval !== null) {

          return;

        }

        this.updateInterval = setInterval(this.handleUpdateInterval, UPDATE_INTERVAL);

      }

      stopUpdateInterval() {

        if (this.updateInterval === null) {

          return;

        }

        clearInterval(this.updateInterval);
        this.updateInterval = null;

      }

      setStatusText(text) {

        this.interfaceStatusIndicator.textContent = `☁ ${text}`;
        this.setStatusVisible(true);

      }

      setStatusVisible(visible) {

        this.interfaceStatusIndicator.classList.toggle('phosphorus-cloud-status-indicator-hidden', !visible);

      }
      onstart() {

        if (this.queuedVariableChanges.length > 0) {

          this.startUpdateInterval();

        }

      }

      onpause() {

        this.stopUpdateInterval();

      }

      update() {

        if (this.stage.username !== this.username) {

          console.log(this.logPrefix, 'username changed to', this.stage.username);

          this.username = this.stage.username;
          this.terminateConnection(4100);
          this.reconnect();

        }

      }

      destroy() {

        this.stopUpdateInterval();
        this.disconnect();

      }

    }

    class LocalStorageCloudHandler extends Extension {

      constructor(stage, id) {

        super(stage);
        this.storageKey = 'cloud-data:' + id;
        this.load();
        this.save = this.save.bind(this);

      }

      variableChanged(name) {

        this.save();

      }

      load() {

        try {

          const savedData = localStorage.getItem(this.storageKey);

          if (savedData === null) {

            return;

          }

          const parsedData = JSON.parse(savedData);

          for (const key of Object.keys(parsedData)) {

            if (this.stage.cloudVariables.indexOf(key) > -1) {

              this.stage.vars[key] = parsedData[key];

            }

          }

        } catch (e) {

          console.warn('cannot read from localStorage', e);

        }

      }

      save() {
        try {

          localStorage.setItem(this.storageKey, JSON.stringify(getAllCloudVariables(this.stage)));

        } catch (e) {

          console.warn('cannot save to localStorage', e);

        }
      }

    }

    return {

      getAllCloudVariables:getAllCloudVariables,
      WebSocketCloudHandler:WebSocketCloudHandler,
      LocalStorageCloudHandler:LocalStorageCloudHandler

    }

  }(Extension))


/*!
Parts of this file (microphone.ts) are derived from https://github.com/LLK/scratch-audio/blob/develop/src/Loudness.js
*/

  var microphone  = (function(Extension){
    let microphone = null;
    let state = 0;
    const CACHE_TIME = 1000 / 30;
    function createAnalyzerDataArray(analyzer) {
      if (!!analyzer.getFloatTimeDomainData) {
        return new Float32Array(analyzer.fftSize);
      }
      else if (!!analyzer.getByteTimeDomainData) {
        return new Uint8Array(analyzer.fftSize);
      }
      else {
        throw new Error('Analyzer node does not support getFloatTimeDomainData or getByteTimeDomainData');
      }
    }
    function connect() {
      if (state !== 0) {
        return;
      }
      if (!P.audioContext) {
        console.warn('Cannot connect to microphone without audio context.');
        state = 3;
        return;
      }
      if (!navigator.mediaDevices) {
        console.warn('Cannot access media devices, probably running in insecure (non-HTTPS) context.');
        state = 3;
        return;
      }
      state = 2;
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((mediaStream) => {
        const source = P.audioContext.createMediaStreamSource(mediaStream);
        const analyzer = P.audioContext.createAnalyser();
        if (!analyzer.getFloatTimeDomainData) {
          throw new Error('Missing API getFloatTimeDomainData');
        }
        source.connect(analyzer);
        microphone = {
          source: source,
          stream: mediaStream,
          analyzer,
          dataArray: createAnalyzerDataArray(analyzer),
          lastValue: -1,
          lastCheck: 0,
        };
        state = 1;
      })
        .catch((err) => {
        console.warn('Cannot connect to microphone: ' + err);
        state = 3;
      });
    }
    function reinitAnalyser() {
      if (!microphone) {
        throw new Error('Microphone not connected; cannot re-init something that does not exist!');
      }
      const analyzer = P.audio.context.createAnalyser();
      microphone.source.disconnect();
      microphone.source.connect(analyzer);
      microphone.analyzer = analyzer;
      if (microphone.dataArray.length !== analyzer.fftSize) {
        microphone.dataArray = createAnalyzerDataArray(analyzer);
      }
    }
    function getLoudness() {

      if (microphone === null) {

        connect();
        return -1;

      }

      if (!microphone.stream.active) {

        return -1;

      }

      if (Date.now() - microphone.lastCheck < CACHE_TIME) {

        return microphone.lastValue;

      }

      let sum = 0;

      if (microphone.dataArray instanceof Float32Array) {

        microphone.analyzer.getFloatTimeDomainData(microphone.dataArray);

        for (let i = 0; i < microphone.dataArray.length; i++) {

          sum += Math.pow(microphone.dataArray[i], 2);

        }

      } else {

        microphone.analyzer.getByteTimeDomainData(microphone.dataArray);

        for (let i = 0; i < microphone.dataArray.length; i++) {

          sum += Math.pow((microphone.dataArray[i] - 128) / 128, 2);

        }

      }

      let rms = Math.sqrt(sum / microphone.dataArray.length);

      if (microphone.lastValue !== -1) {
        rms = Math.max(rms, microphone.lastValue * 0.6);
      }

      microphone.lastValue = rms;
      rms *= 1.63;
      rms = Math.sqrt(rms);
      rms = Math.round(rms * 100);
      rms = Math.min(rms, 100);

      return rms;

    }

    class MicrophoneExtension extends Extension {

      getLoudness() {

        return getLoudness();

      }

      onstart() {

        if (microphone) {

          reinitAnalyser();

        }

      }

    }

    return {

      MicrophoneExtension:MicrophoneExtension,

    }

  }(Extension));

  var tts = (function(Extension){

    let Gender = {};

    (function (Gender) {
      Gender[Gender["Male"] = 0] = "Male";
      Gender[Gender["Female"] = 1] = "Female";
      Gender[Gender["Unknown"] = 2] = "Unknown";
    })(Gender);

    const femaleVoices = [
      /Zira/,
      /female/i,
    ];

    const maleVoices = [
      /David/,
      /\bmale/i,
    ];

    const scratchVoices = {

      ALTO: { gender: Gender.Female, pitch: 1, rate: 1 },
      TENOR: { gender: Gender.Male, pitch: 1.5, rate: 1 },
      GIANT: { gender: Gender.Male, pitch: 0.5, rate: 0.75 },
      SQUEAK: { gender: Gender.Female, pitch: 2, rate: 1.5 },
      KITTEN: { gender: Gender.Female, pitch: 2, rate: 1 },

    };

    class TextToSpeechExtension extends Extension {

      constructor(stage) {

        super(stage);
        this.language = 'en';
        this.voice = 'ALTO';
        this.supported = 'speechSynthesis' in window;

        if (!this.supported) {

          console.warn('TTS extension is not supported in this browser: it requires the speechSynthesis API https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis');
        
        } else {

          speechSynthesis.getVoices();

        }

      }

      getVoiceGender(voice) {

        if (femaleVoices.some((i) => i.test(voice.name)))
          return Gender.Female;
        if (maleVoices.some((i) => i.test(voice.name)))
          return Gender.Male;

        return Gender.Unknown;

      }

      getVoiceData(voiceName) {

        const matchesGender = (voice) => this.getVoiceGender(voice) === voiceGender;
        const voice = scratchVoices[voiceName];
        const rate = voice.rate;
        const pitch = voice.pitch;
        const voiceGender = scratchVoices[this.voice].gender;
        const voices = speechSynthesis.getVoices();
        const matchesLanguage = voices.filter((i) => i.lang.substr(0, 2) === this.language.substr(0, 2));
        
        let candidates = matchesLanguage.filter(matchesGender);
        
        if (candidates.length === 0)
          candidates = matchesLanguage;
        
        if (candidates.length === 0)
          candidates = voices;

        const defaultVoice = candidates.find((i) => i.default);

        return {

          voice: defaultVoice || candidates[0] || null,
          pitch,
          rate,

        };

      }

      setVoice(voice) {

        if (!scratchVoices.hasOwnProperty(voice)) {
          return;
        }
        this.voice = voice;

      }

      setLanguage(language) {

        this.language = language;

      }

      speak(text) {

        if (!this.supported) {
          return Promise.resolve();
        }

        if (this.voice === 'KITTEN')
          text = text.replace(/\w+?\b/g, 'meow');

        return new Promise((resolve, reject) => {
          const end = () => resolve();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = this.language;
          const { voice, rate, pitch } = this.getVoiceData(this.voice);
          utterance.voice = voice;
          utterance.rate = rate;
          utterance.pitch = pitch;
          utterance.onerror = end;
          utterance.onend = end;
          speechSynthesis.speak(utterance);
          speechSynthesis.resume();
        });

      }
      onstart() {

        if (this.supported) {

          speechSynthesis.resume();

        }

      }

      onpause() {

        if (this.supported) {
          speechSynthesis.pause();
        }

      }

      destroy() {

        if (this.supported) {

          speechSynthesis.cancel();

        }

      }
    }

    return {

      Gender:Gender,
      TextToSpeechExtension:TextToSpeechExtension,

    };

  }(Extension))

  return {

    Extension:Extension,
    cloud:cloud,
    microphone:microphone,
    tts:tts

  }
}())

//# sourceMappingURL=phosphorus.js.map