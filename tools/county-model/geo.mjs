import fs from 'fs'; import {feature} from 'topojson-client';
const topo=JSON.parse(fs.readFileSync('node_modules/us-atlas/counties-10m.json'));
const fc=feature(topo,topo.objects.counties);
const ST={GA:'13',IA:'19',MI:'26',NC:'37',OH:'39',TX:'48'};
const r=a=>Array.isArray(a[0])?a.map(r):[+a[0].toFixed(3),+a[1].toFixed(3)];
for(const [st,f] of Object.entries(ST)){
  const feats=fc.features.filter(x=>x.id.startsWith(f)).map(x=>({type:'Feature',id:x.id,properties:{},geometry:{type:x.geometry.type,coordinates:r(x.geometry.coordinates)}}));
  fs.writeFileSync(`/home/claude/site/data/model/geo/${st}.json`,JSON.stringify({type:'FeatureCollection',features:feats}));
  console.log(st,feats.length);
}
