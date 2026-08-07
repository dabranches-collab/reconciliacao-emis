import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const wrangler=new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url);
const params=JSON.stringify({importId:process.argv[2],actorId:process.argv[3],...(process.argv[4]?{phase:process.argv[4]}:{}),...(process.argv[5]?{startBucket:Number(process.argv[5])}:{})});
const result=spawnSync(process.execPath,[fileURLToPath(wrangler),'workflows','trigger','reconciliacao-emis-v2-finalization',params],{stdio:'inherit'});
process.exit(result.status??1);
