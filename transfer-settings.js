'use strict';
// Bounded values: downloads are assembled in browser memory.
const DEFAULT_TRANSFER=Object.freeze({maxFileMiB:40,downloadBlockKiB:768});
const MAX_FILE_MIB=100;
const BLOCK_OPTIONS=Object.freeze([48,128,256,512,768,1024]);
function validateTransfer(value){
  if(!value||!Number.isInteger(value.maxFileMiB)||value.maxFileMiB<1||value.maxFileMiB>MAX_FILE_MIB||!BLOCK_OPTIONS.includes(value.downloadBlockKiB))
    throw Object.assign(new Error('Limite de 1 a 100 MiB por arquivo e bloco de 48, 128, 256, 512, 768 ou 1024 KiB.'),{status:400});
  return {maxFileMiB:value.maxFileMiB,downloadBlockKiB:value.downloadBlockKiB};
}
module.exports={DEFAULT_TRANSFER,MAX_FILE_MIB,BLOCK_OPTIONS,validateTransfer};
