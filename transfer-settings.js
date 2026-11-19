'use strict';
// Bounded values: downloads are assembled in browser memory.
const DEFAULT_TRANSFER=Object.freeze({maxFileMiB:40,downloadBlockKiB:768,mode:'auto'});
const MAX_FILE_MIB=2147483647; // Numeric limit of PostgreSQL integer, not a transfer policy.
const BLOCK_OPTIONS=Object.freeze([48,128,256,512,768,1024]);
function validateTransfer(value){
  if(!value||!Number.isInteger(value.maxFileMiB)||value.maxFileMiB<1||value.maxFileMiB>MAX_FILE_MIB||!BLOCK_OPTIONS.includes(value.downloadBlockKiB)||(value.mode!==undefined&&!['auto','manual'].includes(value.mode)))
    throw Object.assign(new Error('Informe um limite inteiro positivo em MiB e bloco de 48, 128, 256, 512, 768 ou 1024 KiB.'),{status:400});
  return {maxFileMiB:value.maxFileMiB,downloadBlockKiB:value.downloadBlockKiB,mode:value.mode||'auto'};
}
// Global pressure, not merely the number of students in one room.
// These conservative thresholds are tunable heuristics for a small relay.
function chooseAutoBlock({connected=0,active=0,rssMiB=0}={}){
 const pressure=Math.max(Math.ceil(connected/2),active);
 let block=pressure<=10?1024:pressure<=25?768:pressure<=45?512:pressure<=90?256:pressure<=180?128:48;
 if(rssMiB>=400)block=Math.min(block,48);
 else if(rssMiB>=320)block=Math.min(block,256);
 return block;
}
module.exports={DEFAULT_TRANSFER,MAX_FILE_MIB,BLOCK_OPTIONS,validateTransfer,chooseAutoBlock};
