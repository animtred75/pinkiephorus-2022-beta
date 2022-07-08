// @ts-check

// @ts-ignore
window.Packer = (function() {
    'use strict';
  
    // @ts-ignore
    const SBDL = window.SBDL;
    // @ts-ignore
    const JSZip = window.JSZip;
  
    /**
     * A file that represents a script or stylesheet to be included in the packager output.
     * @typedef {Object} PackagerFile
     * @property {'script'|'style'} type The type of file
     * @property {string} src Where to fetch the file from, relative to the forkphorus root
     * @property {boolean} [loaded] Whether the file has been loaded.
     * @property {string} [content] Raw text of the file
     * @property {string[]} [inlineSources] File paths to include with data: URIs
     */
  
    /**
     * A runtime asset to be included in the packager output.
     * @typedef {Object} PackagerAsset
     * @property {string} src Where to fetch the file from, relative to the forkphorus root
     * @property {boolean} [loaded] Whether the file has been loaded.
     * @property {Blob} [blob] Raw binary data of the asset
     * @property {string} [data] Raw binary data the asset in the form of a data: URI
     */
  
    /**
     * Convert a Blob to a data: URI
     * @param {Blob} blob Blob or file to be read
     */
    function readAsURL(blob) {
      return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = () => {
          const result = /** @type {string} */ (fileReader.result);
          if (result.length === 0) {
            reject(new Error('File could not be read, it may be too large. (length 0)'));
            return;
          }
          resolve(result);
        };
        fileReader.onerror = (e) => {
          reject(new Error('Error reading file'));
        };
        fileReader.readAsDataURL(blob);
      });
    }
  
    /**
     * Create an archive from an SBDL files result
     * @param {*} files
     * @param {Progress} progress
     */
    function createArchive(files, progress) {
      progress.start();
      const zip = new JSZip();
      for (const file of files) {
        const path = file.path;
        const data = file.data;
        zip.file(path, data);
      }
      return zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
      }, (metadata) => {
        progress.setProgress(metadata.percent);
        progress.setCaption(metadata.currentFile);
      }).then((archive) => {
        progress.setProgress(1);
        return archive;
      });
    }
  
    /**
     * Helper class for users to implement progress monitoring.
     */
    class Progress {
      newTask() {}
      endTask() {}
      setProgress(progress) {}
      setCaption(text) {}
      start() {}
    }
  
    /**
     * FileLoader downloads files for use in the packager.
     */
    class FileLoader {
      constructor() {
        this.progress = new Progress();
        /** @type {PackagerFile[]} */
        this.files = [];
        /** @type {PackagerAsset[]} */
        this.assets = [];
        /** @type {string} */
        this.pathPrefix = '../';
      }
  
      /**
       * @param {string} source
       */
      async _loadInlineSource(source) {
        const response = await fetch(this.pathPrefix + source);
        const blob = await response.blob();
        const url = await readAsURL(blob);
        return url;
      }
  
      /**
       * @param {PackagerFile} file
       */
      async _loadFile(file) {
        const response = await fetch(this.pathPrefix + file.src);
        let body = await response.text();
  
        if (file.inlineSources) {
          for (const source of file.inlineSources) {
            const sourceData = await this._loadInlineSource(source);
            // string.replace only does the first occurrence, but a source may appear multiple times in the file
            while (body.includes(source)) {
              body = body.replace(source, sourceData);
            }
          }
        }
  
        file.loaded = true;
        file.content = body;
      }
  
      /**
       * @param {PackagerAsset} asset
       */
      async _loadAsset(asset) {
        const response = await fetch(this.pathPrefix + asset.src);
        const blob = await response.blob();
        const data = await readAsURL(blob);
        asset.loaded = true;
        asset.blob = blob;
        asset.data = data;
      }
  
      /**
       * @param {PackagerFile[]} files
       */
      _concatenateFiles(files) {
        return files.map((i) => i.content).join('\n');
      }
  
      /**
       * Fetch & load any assets that have not yet been loaded.
       */
      async loadMissingAssets() {
        const missingFiles = this.files.filter((i) => !i.loaded);
        const missingAssets = this.assets.filter((i) => !i.loaded);
  
        if (missingFiles.length > 0 || missingAssets.length > 0) {
          this.progress.start();
          await Promise.all([
            ...missingFiles.map((i) => this._loadFile(i)),
            ...missingAssets.map((i) => this._loadAsset(i)),
          ]);
        }
  
        return {
          scripts: this._concatenateFiles(this.files.filter((i) => i.type === 'script')),
          styles: this._concatenateFiles(this.files.filter((i) => i.type === 'style')),
          assets: this.assets,
        };
      }
    }
  
    /**
     * JSZip wrapper.
     */
    class Zipper {
      constructor() {
        this.progress = new Progress();
        this.files = [];
      }
  
      /**
       * Add a file to this zipper.
       * @param {string} name The name of the file
       * @param {string|Blob} data The file's data
       */
      addFile(name, data) {
        this.files.push({ path: name, data });
      }
  
      /**
       * @param {string} html HTML output from a Packager
       */
      zip(html) {
        return createArchive(this.files, this.progress);
      }
    }
  
    /**
     * Converts Scratch projects to HTML.
     */
    class Packager {
      constructor({ fileLoader }) {
        this.fileLoader = fileLoader;
  
        /** Options to be passed to player.setOptions() */
        this.playerOptions = {
          fullscreenPadding: 0,
          fullscreenMode: 'window',
        };
  
        /** Options to be passed to player.addControls(). if null, addControls() is not called. */
        this.controlsOptions = null;
  
        /** Options regarding the loading screen. */
        this.loadingScreenOptions = {
          text: 'forkphorus',
        };
  
        this.projectType = null;
        this.projectData = null;
  
        this.projectAttribution = '';
  
        this.archiveProgress = new Progress();
      }
  
      _resultToBlob(result) {
        switch (result.type) {
          case 'zip': {
            return createArchive(result.files, this.archiveProgress);
          }
          case 'buffer': {
            return new Blob([result.buffer]);
          }
          default: {
            throw new Error('Unknown result type: ' + result.type);
          }
        }
      }
  
      /**
       * @param {string} id
       */
      async _getProjectTypeById(id) {
        const res = await fetch('https://projects.scratch.mit.edu/' + id);
        if (res.status !== 200) {
          if (res.status === 404) {
            throw new Error('Project does not exist: ' + id);
          }
          throw new Error('Cannot get project, got error code: ' + res.status);
        }
  
        const responseClone = res.clone();
  
        let data;
        try {
          data = await res.json();
        } catch (e) {
          // binary file, try to see if it could be a Scratch 2 project
          const blob = await responseClone.blob();
          try {
            await JSZip.loadAsync(blob);
            // if loadAsync doesn't reject, this is valid zip, and is probably a Scratch 2 project
            return 'sb2';
          } catch (e) {
            // not a zip, probably a .sb
            return 'sb';
          }
        }
  
        if ('targets' in data) return 'sb3';
        if ('objName' in data) return 'sb2';
        throw new Error('Unknown project type');
      }
  
      /**
       * @param {string} id
       */
      async _getProjectById(id) {
        // TODO: don't fetch the project data twice, especially important for binary projects.
        const type = await this._getProjectTypeById(id);
        const result = await SBDL.loadProject(id, type);
        const blob = await this._resultToBlob(result);
        const url = await readAsURL(blob);
        return {
          url: url,
          type: type,
        };
      }
  
      /**
       * Load a project using its ID on scratch.mit.edu
       * @param {string} id The project's ID
       */
      async loadProjectById(id) {
        const { url, type } = await this._getProjectById(id);
        this.projectData = url;
        this.projectType = type;
      }
  
      /**
       * Load a project from a File
       * @param {File} file The file to be read
       */
      async loadProjectFromFile(file) {
        const extension = file.name.split('.').pop();
        const url = await readAsURL(file);
        this.projectType = extension;
        this.projectData = url;
      }
  
      /**
       * Run the packager, and generate a result HTML page. Must be run after one of the load() methods resolves.
       */
      async run() {
        if (!this.projectData) {
          throw new Error(`missing project data (projectData=${this.projectData})`);
        }
        if (!this.projectType) {
          throw new Error(`missing project type (projectType=${this.projectType})`);
        }
  
        const { scripts, styles, assets } = await this.fileLoader.loadMissingAssets();
        const assetManagerData = '{' + assets.map((asset) => `"${asset.src}": "${asset.data}"`).join(', ') + '}';
  
        const body = `<!DOCTYPE html>
        <html lang="en">
            <head>
                <title>${this.playerOptions.title || 'Pinkiephorus'}</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta name="description" content="Pinkiephorus is a JavaScript compiler for Scratch 3, 2, and 1 projects.">
                <style>
                    // Pinkiephorus styles...
                    ${styles}

                    /* Player styles... */
                    body{
                        font-family: 'mlp';
                        margin: 0px;
                        top: 0px;
                        left: 0px;
                        overflow: hidden;
                        background: rgb(0, 0, 0);
                    }
                    #pinkiephorus-stage {
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%,-50%);
                        margin: 0px;
                    }
                    #pinkiephorus-loading {
                      color: #fff;
                    }
                </style>
            </head>
            <body>
                <div id="pinkiephorus-stage"></div>
                <h1 id="pinkiephorus-loading">Please Wait</h1>
                <script>
                    // Pinkiephorus scripts...
                    ${scripts}
                    P.config.useWebGL = ${this.playerOptions.webgl};
                    (function () {
                        'use strict';
                        var playerArea = document.getElementById('pinkiephorus-stage');
                        var player = new P.player.Player();
                        window.player = player;
                        var clicktoplay = document.getElementById('clicktoplay');
                        function URLsearchParams(name,isD) {
                            return new URL(window.location.href).searchParams.get(name);
                        }
                        
                        function SupdateFullscreen() {
                            if (((window.innerHeight /  360) - (window.innerWidth /  480)) > 0) {
                                player.setZoom((window.innerWidth /  480));
                            } else {
                                player.setZoom((window.innerHeight /  360));
                            }
                        }

                        player.onload.subscribe(function(){
                          document.getElementById('pinkiephorus-loading').remove();
                          playerArea.appendChild(player.root);
                        });

                        SupdateFullscreen();
                        window.addEventListener('resize', () => {
                            SupdateFullscreen();
                        });
                        var project = '${this.projectData}';

                        var playerOptions = ${JSON.stringify(this.playerOptions)};
                        // Controls options...
                        var controlsOptions = ${JSON.stringify(this.controlsOptions)};

                        player.setOptions(playerOptions);
                        if (controlsOptions) {
                            player.addControls(controlsOptions);
                        }
                        player.loadProjectURL(project);
                    }())
                </script>
            </body>
        </html>`;
        return body;
      }
    }
  
    return {
      FileLoader,
      Zipper,
      Packager,
    };
  }());