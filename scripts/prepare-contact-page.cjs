'use strict';
const fs=require('node:fs'),path=require('node:path');
function generate(source){
 function replaceOnce(before,after){if(source.split(before).length!==2)throw Error('Contact page source contract changed: '+before);source=source.replace(before,after);}
 replaceOnce('0.89.0-test.4blocks.16 · 4blocks-reaches-ui1','0.89.0-test.4blocks.17 · 4blocks-contacts-ui1');
 replaceOnce('<script src="coupled-water-ui.js"></script>','<script src="runoff-water-contacts.js"></script><script src="water-contact-readout.js"></script><script src="coupled-water-ui.js"></script>');
 replaceOnce('let highlight;try{highlight=','const contactReadout=WaterContactReadout.create({getContext:f=>diagnostic.data(f,\'regional\'),getThreshold:()=>$(\'reachThreshold\').value,routing:RainfallRunoffRouting,reaches:RunoffReachNetwork,contacts:RunoffWaterContacts,objects:SurfaceWaterObjects});let highlight;try{highlight=');
 replaceOnce('isLocked:()=>projects.busy,highlight});','isLocked:()=>projects.busy,highlight,describeContacts:(r,c,id)=>contactReadout.describe(r,c,id)});');
 replaceOnce('<div class="panes">','<p>TEST .17: карточки воды показывают пространственные контакты с окончаниями водотоков и событиями перелива обеих фаз. Они не доказывают постоянные притоки или истоки. Порог берётся из поля водотоков; видимость диагностических слоёв на карточку не влияет.</p><p><a href="terrain-editor.html">Экспериментальный редактор суши и рельефа · editor-ui1</a> — отдельный кадр, отдельные файлы правок; не проект A/B.</p><div class="panes">');
 return source;
}
function prepare(){const dir=path.join(__dirname,'../src'),out=generate(fs.readFileSync(path.join(dir,'drainage-candidate.html'),'utf8'));fs.writeFileSync(path.join(dir,'water-contacts-candidate.html'),out);return out;}
module.exports={generate,prepare};if(require.main===module)prepare();
