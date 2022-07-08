window.SBDL = (function() {
    'use strict';
    function IOjson(json) {
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
                    }
                    else {
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
                    }
                    else {
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
                    }
                    else {
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
    function IOreader(blob, type) {
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
    function loadURL(url, type) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url);
            xhr.responseType = type || '';
            xhr.onload = () => {
                resolve(xhr.response);
            };
            xhr.send();
        });
    }
    async function loadProject(id) {
        return new Promise(async (resolve, reject) => {
            var projectAssets = [];
            var projectAssetObj = {};
            if (SBDL.progressCallback) SBDL.progressCallback('loading project data');
            var projectData = await loadURL('https://projects.scratch.mit.edu/' + id, 'blob');
            function addAsset(md5) {
                projectAssetObj[md5] = md5;
            }
            function returnAsset(md5) {
                return {md5: md5, result: ''};
            }
            try {
                var projectJSON = IOjson(await IOreader(projectData, 'text'));
                function addAssetObjectSB3(obj) {
                    for (let index = 0; index < obj.costumes.length; index++) {
                        const costumeAssets = obj.costumes[index];
                        addAsset(costumeAssets.assetId + '.' + costumeAssets.dataFormat);
                    }
                    for (let index = 0; index < obj.sounds.length; index++) {
                        const soundAssets = obj.sounds[index];
                        addAsset(soundAssets.assetId + '.' + soundAssets.dataFormat);
                    }
                }
                for (let index = 0; index < projectJSON.targets.length; index++) {
                    const targetsObject = projectJSON.targets[index];
                    addAssetObjectSB3(targetsObject);
                }
                projectAssets = [];
                for (let index = 0; index < Object.keys(projectAssetObj).length; index++) {
                    var asset = Object.keys(projectAssetObj)[index];
                    projectAssets.push(returnAsset(asset));
                }
                var zip = new JSZip();
                zip.file('project.json', JSON.stringify(projectJSON));
                for (let index = 0; index < projectAssets.length; index++) {
                    var md5 = projectAssets[index];
                    if (SBDL.progressCallback) SBDL.progressCallback('loading project file (' + index + '/' + projectAssets.length + ')');
                    md5.result = await loadURL('https://assets.scratch.mit.edu/internalapi/asset/' + md5.md5 + '/get', 'arraybuffer');
                    zip.file(md5.md5, md5.result);
                }
                resolve(await zip.generateAsync({type: 'blob'}));
            } catch (e) {
                resolve(projectData);
            }
        });
    }
    return {
        progressCallback: null,
        IOreader: IOreader,
        loadProject: loadProject,
    };
}());