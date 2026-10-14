'use strict';
// ETEC Web v3: gravacao e verificacao REAL na pasta autorizada pelo professor.
// Nao transfere arquivos para o Neon; nao registra recibo antes de todos os arquivos serem relidos.
// Usado como script proprio no navegador ou por testes Node via module.exports.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.EtecV3Edge = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const INTERNAL_FILENAME = /^[a-f0-9]{32}\.(?:pdf|doc|docx|odt|ppt|pptx|xls|xlsx|ods|txt|csv|jpg|jpeg|png|zip|json|md|sql)$/;
  const SHA = /^[a-f0-9]{64}$/;
  const MAX_FILE = 40 * 1024 * 1024;
  const MAX_TOTAL = 100 * 1024 * 1024;
  const MAX_FILES = 10;
  const CHUNK = 1024 * 1024;
  function check(ok, message) { if (!ok) throw new Error(message); }
  function safePhysicalPath(value, submissionId) {
    check(typeof value === 'string', 'Caminho fisico invalido.');
    const parts = value.split('/');
    check(parts.length === 6 && parts[0] === 'ENTREGAS' &&
      parts.slice(1, 5).every(p => UUID.test(p)) && parts[4] === submissionId &&
      INTERNAL_FILENAME.test(parts[5]), 'Caminho fora da pasta privativa de entregas.');
    return parts;
  }
  function hex(buffer) { return [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  async function checksum(file, subtle) {
    check(file && typeof file.arrayBuffer === 'function' && typeof file.size === 'number', 'Arquivo invalido.');
    return hex(await subtle.digest('SHA-256', await file.arrayBuffer()));
  }
  async function folderFor(rootHandle, parts) {
    let dir = rootHandle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, {create:true});
    return dir;
  }
  async function newFileHandle(dir, name) {
    // Nunca sobrescrever: a ausencia deve ser confirmada antes de criar o arquivo fisico.
    try {
      await dir.getFileHandle(name, {create:false});
      throw new Error('Ja existe arquivo fisico nesse destino. Interrompa e solicite reconciliacao.');
    } catch (error) {
      if (!error || error.name !== 'NotFoundError') throw error;
    }
    return dir.getFileHandle(name, {create:true});
  }
  function checkPlan(plan, files) {
    check(plan && UUID.test(plan.submissionId) && Array.isArray(plan.files) && Array.isArray(files), 'Plano de entrega invalido.');
    check(plan.files.length >= 1 && plan.files.length <= MAX_FILES && files.length === plan.files.length, 'Numero de arquivos divergente.');
    let total = 0; const ids = new Set(); const locations = new Set();
    const jobs = plan.files.map(entry => {
      check(entry && UUID.test(entry.fileId) && !ids.has(entry.fileId), 'Identificador de arquivo invalido.');
      ids.add(entry.fileId);
      const parts = safePhysicalPath(entry.physicalPath, plan.submissionId);
      check(!locations.has(entry.physicalPath), 'Destino duplicado.');
      locations.add(entry.physicalPath);
      check(Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_FILE && SHA.test(entry.sha256), 'Manifesto de integridade invalido.');
      const source = files.find(f => f && f.fileId === entry.fileId);
      check(source && source.file && source.file.size === entry.size && source.name === entry.name, 'Arquivo selecionado nao corresponde ao manifesto.');
      total += entry.size;
      check(total <= MAX_TOTAL, 'Entrega acima de 100 MB.');
      return {entry, parts, source:source.file};
    });
    check(new Set(files.map(f=>f.fileId)).size === jobs.length, 'Arquivos recebidos duplicados.');
    return jobs;
  }
  async function writeVerifiedSubmission({rootHandle, plan, files, subtle}) {
    check(rootHandle && typeof rootHandle.getDirectoryHandle === 'function', 'Selecione uma pasta no Edge.');
    check(subtle && typeof subtle.digest === 'function', 'SHA-256 nao esta disponivel.');
    if (typeof rootHandle.queryPermission === 'function') {
      const permission = await rootHandle.queryPermission({mode:'readwrite'});
      check(permission === 'granted', 'A permissao da pasta deve ser concedida pelo professor antes do envio.');
    }
    const jobs = checkPlan(plan, files); // Valida tudo antes de criar pastas.
    const evidence = [];
    for (const {entry, parts, source} of jobs) {
      // SHA do arquivo recebido nao substitui a verificacao dos bytes gravados.
      check(await checksum(source, subtle) === entry.sha256, 'Integridade do arquivo recebido divergente.');
      const directory = await folderFor(rootHandle, parts.slice(0, -1));
      const handle = await newFileHandle(directory, parts.at(-1));
      const writer = await handle.createWritable({keepExistingData:false});
      let closed = false;
      try {
        for (let pos = 0; pos < source.size; pos += CHUNK) {
          const fragment = source.slice(pos, Math.min(pos + CHUNK, source.size));
          await writer.write(await fragment.arrayBuffer());
        }
        await writer.close();
        closed = true;
      } catch (error) {
        if (!closed && typeof writer.abort === 'function') await writer.abort().catch(() => {});
        // Nao eliminar arquivos parciais: requer revisao em area fisica reservada.
        throw error;
      }
      const saved = await handle.getFile();
      check(saved.size === entry.size && await checksum(saved, subtle) === entry.sha256,
        'O arquivo fisico gravado nao corresponde ao original; nenhum comprovante pode ser emitido.');
      evidence.push({fileId:entry.fileId, size:saved.size, sha256:entry.sha256});
    }
    return evidence;
  }
  // Recebe fragmentos via HTTPS e grava cada arquivo diretamente no Edge.
  // Um identificador de transferencia corresponde a um unico destino fisico.
  function createChunkReceiver({rootHandle,subtle}) {
    check(rootHandle&&typeof rootHandle.getDirectoryHandle==='function','Selecione uma pasta no Edge.');
    check(subtle&&typeof subtle.digest==='function','SHA-256 indisponivel.');
    const active=new Map();
    async function start({transferId,submissionId,file}) {
      check(UUID.test(transferId)&&!active.has(transferId),'Transferencia duplicada.');
      check(file&&UUID.test(file.fileId)&&Number.isSafeInteger(file.size)&&file.size>=0&&file.size<=MAX_FILE&&SHA.test(file.sha256),'Arquivo nao autorizado.');
      const parts=safePhysicalPath(file.physicalPath,submissionId);
      if(typeof rootHandle.queryPermission==='function')check(await rootHandle.queryPermission({mode:'readwrite'})==='granted','Permissao de escrita nao concedida.');
      const dir=await folderFor(rootHandle,parts.slice(0,-1));
      const handle=await newFileHandle(dir,parts[5]);
      const writer=await handle.createWritable({keepExistingData:false});
      active.set(transferId,{file,handle,writer,received:0,seq:0});
    }
    async function append({transferId,seq,bytes}) {
      const a=active.get(transferId);
      check(a&&Number.isSafeInteger(seq)&&seq===a.seq,'Sequencia de transferencia invalida.');
      check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=48*1024&&a.received+bytes.length<=a.file.size,'Fragmento com tamanho invalido.');
      await a.writer.write(bytes);
      a.received+=bytes.length;a.seq++;
      return {received:a.received,nextSeq:a.seq};
    }
    async function finish(transferId) {
      const a=active.get(transferId);
      check(a&&a.received===a.file.size,'Arquivo incompleto.');
      // Mantenha entrada ativa durante verificacao para impedir iniciacao duplicada.
      await a.writer.close();
      const saved=await a.handle.getFile();
      check(saved.size===a.file.size&&await checksum(saved,subtle)===a.file.sha256,'Falha na verificacao SHA-256 do arquivo gravado.');
      active.delete(transferId);
      return {fileId:a.file.fileId,size:saved.size,sha256:a.file.sha256};
    }
    async function abort(transferId) {
      const a=active.get(transferId);if(!a)return;
      active.delete(transferId);
      if(typeof a.writer.abort==='function')await a.writer.abort().catch(()=>{});
      // A pasta fica reservada. Arquivos residuais exigem reconciliacao manual.
    }
    return Object.freeze({start,append,finish,abort});
  }
  return Object.freeze({safePhysicalPath, checksum, checkPlan, writeVerifiedSubmission, createChunkReceiver});
});
