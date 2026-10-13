'use strict';
// Persistencia: PostgreSQL (DATABASE_URL) no Render; JSON local apenas no desenvolvimento.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function publicTeacher(t) { return {id:t.id,username:t.username,name:t.name,school:t.school,active:t.active,createdAt:t.created_at,version:t.version}; }
function createUserStore() {
  const dburl = process.env.DATABASE_URL;
  if (dburl) {
    // Instalado automaticamente com npm install no Render.
    const {Pool} = require('pg');
    const pool = new Pool({connectionString:dburl,max:5,connectionTimeoutMillis:12000,idleTimeoutMillis:30000});
    let initialized;
    async function ready() {
      if (!initialized) initialized = pool.query(`CREATE TABLE IF NOT EXISTS etec_teachers (
        id text PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL, school text NOT NULL DEFAULT '',
        salt text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now())`).catch(err=>{initialized=null;throw err;});
      await initialized;
    }
    return {
      mode:'postgres', ready,
      async list() {await ready(); const r=await pool.query('SELECT * FROM etec_teachers ORDER BY name ASC');return r.rows.map(publicTeacher);},
      async byUsername(username) {await ready();const r=await pool.query('SELECT * FROM etec_teachers WHERE username=$1',[username]);return r.rows[0]||null;},
      async byId(id) {await ready();const r=await pool.query('SELECT * FROM etec_teachers WHERE id=$1',[id]);return r.rows[0]||null;},
      async create(t) {await ready();const r=await pool.query('INSERT INTO etec_teachers(id,username,name,school,salt,password_hash,active,version) VALUES ($1,$2,$3,$4,$5,$6,true,1) RETURNING *',[t.id,t.username,t.name,t.school,t.salt,t.password_hash]);return publicTeacher(r.rows[0]);},
      async setPassword(id,salt,hash) {await ready();const r=await pool.query('UPDATE etec_teachers SET salt=$2,password_hash=$3,version=version+1 WHERE id=$1 RETURNING *',[id,salt,hash]);return r.rows[0]?publicTeacher(r.rows[0]):null;},
      async setActive(id,active) {await ready();const r=await pool.query('UPDATE etec_teachers SET active=$2,version=version+1 WHERE id=$1 RETURNING *',[id,active]);return r.rows[0]?publicTeacher(r.rows[0]):null;},
    };
  }
  // Sem DATABASE_URL no Render: NAO cadastrar professores com armazenamento efemero.
  if (process.env.NODE_ENV === 'production') {
    const unavailable=async()=>{throw Object.assign(new Error('Configure DATABASE_URL com um PostgreSQL persistente para cadastrar professores. Consulte o GUIA-DE-ATUALIZACAO.md.'),{status:503});};
    return {mode:'unconfigured',ready:async()=>{},list:unavailable,byId:unavailable,byUsername:unavailable,create:unavailable,setPassword:unavailable,setActive:unavailable};
  }
  // Desenvolvimento e testes: arquivo fora do Git, gravado com rename atomico.
  const filename=process.env.TEACHERS_FILE || path.join(__dirname,'users.local.json');
  async function read(){try{return JSON.parse(fs.readFileSync(filename,'utf8'));}catch(err){if(err.code==='ENOENT')return [];throw err;}}
  async function save(users){fs.mkdirSync(path.dirname(filename),{recursive:true});const tmp=filename+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(users,null,2),{mode:0o600});fs.renameSync(tmp,filename);}
  return {
    mode:'local-development',ready:async()=>{},
    async list(){return (await read()).map(publicTeacher);},
    async byId(id){return (await read()).find(t=>t.id===id)||null;},
    async byUsername(username){return (await read()).find(t=>t.username===username)||null;},
    async create(t){const all=await read();if(all.some(x=>x.username===t.username))throw Object.assign(new Error('Usuario ja cadastrado.'),{status:409});const obj={...t,active:true,version:1,created_at:new Date().toISOString()};all.push(obj);await save(all);return publicTeacher(obj);},
    async setPassword(id,salt,hash){const all=await read(), t=all.find(x=>x.id===id);if(!t)return null;t.salt=salt;t.password_hash=hash;t.version++;await save(all);return publicTeacher(t);},
    async setActive(id,active){const all=await read(),t=all.find(x=>x.id===id);if(!t)return null;t.active=active;t.version++;await save(all);return publicTeacher(t);},
  };
}
module.exports={createUserStore};
