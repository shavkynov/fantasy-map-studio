 'use strict';
const fs=require('node:fs'),path=require('node:path');
function inject(text){const tag='<script src="world-atlas-render.js"></script>',anchor='<script src="app.js"></script>';if(text.split(tag).length>2)throw Error('Duplicate atlas script');if(text.includes(tag)){if(text.indexOf(tag)>text.indexOf(anchor))throw Error('Atlas must load before app');return text;}if(text.split(anchor).length!==2)throw Error('Main entry contract changed');return text.replace(anchor,tag+'\n'+anchor);}
function prepare(){const file=path.join(__dirname,'../src/index.html'),before=fs.readFileSync(file,'utf8'),after=inject(before);if(after!==before)fs.writeFileSync(file,after);return after;}
module.exports={inject,prepare};if(require.main===module)prepare();
