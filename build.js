var fs = require('fs-extra');
var path = require('path');

var cpPaths = {
    'src/index.js': 'dist/index.js',
    'src/static/favicon.ico': 'dist/static/favicon.ico',
    'src/static/js/ui.js': 'dist/static/js/ui.js',
    'src/static/css/style.css': 'dist/static/css/style.css',
    'node_modules/resemblejs/resemble.js':  'dist/static/js/resemble.js',
    'node_modules/jsondiffpatch/public/build/jsondiffpatch.js': 'dist/static/js/jsondiffpatch/jsondiffpatch.js',
    'node_modules/jsondiffpatch/public/build/jsondiffpatch-formatters.js': 'dist/static/js/jsondiffpatch/jsondiffpatch-formatters.js',
    'node_modules/jsondiffpatch/public/formatters-styles/html.css': 'dist/static/css/jsondiffpatch/html.css'
};

process.chdir(__dirname);

for(var sourcePath in cpPaths){
    var existsTester = fs.statSync(path.dirname(sourcePath));
    if(!existsTester.isDirectory()){
        fs.mkDirSync(path.dirname(sourcePath));
    }
    fs.copySync(sourcePath, cpPaths[sourcePath]);
}

console.log('Done - output is in dist/')
