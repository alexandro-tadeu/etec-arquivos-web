"""Teste opcional com playwright: pip install playwright e Chromium instalado."""
import asyncio, subprocess, os, socket, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
MOCK = '''
window.__files = { 'material.txt': 'Conteudo da aula', 'Trabalhos': { } };
function directory(contents,name){
 return {
   kind:'directory',name,
   async *entries(){for(const [name,v] of Object.entries(contents)) yield [name,typeof v==='object' ? {kind:'directory'}:{kind:'file'}]},
   async *keys(){for(const name of Object.keys(contents)) yield name},
   async getDirectoryHandle(key,{create}={}){if(typeof contents[key]!=='object')throw new DOMException('Not found','NotFoundError');return directory(contents[key],key)},
   async getFileHandle(key,opts={}){
     if(contents[key]===undefined && opts.create)contents[key]='';
     if(contents[key]===undefined)throw new DOMException('Not found','NotFoundError');
     if(typeof contents[key]==='object')throw new DOMException('Wrong kind','TypeMismatchError');
     return {kind:'file', name:key, async getFile(){return new File([contents[key]], key)}, async createWritable(){let parts=[];return {async write(b){parts.push(b)},async close(){const blob = new Blob(parts);contents[key] = await blob.text()},async abort(){delete contents[key]}}}};
   }
 }
}
window.showDirectoryPicker=async()=>directory(window.__files,'Aula ETEC');
'''
async def wait_port(port):
    for i in range(50):
        try:
            reader, writer = await asyncio.open_connection('127.0.0.1',port)
            writer.close();return
        except ConnectionRefusedError:await asyncio.sleep(.1)
    raise RuntimeError('server not ready')

async def main():
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    proc=subprocess.Popen(['node','server.js'],cwd=ROOT,env={**os.environ,'PORT':str(port),'ADMIN_PASSWORD':'Teste!Admin!2026!Segura','NODE_ENV':'test'},stdout=subprocess.DEVNULL)
    try:
        await wait_port(port)
        async with async_playwright() as p:
            browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--no-proxy-server','--proxy-server=direct://','--proxy-bypass-list=*'])
            teacher=await browser.new_page(viewport={'width':1140,'height':900},accept_downloads=True)
            await teacher.add_init_script(MOCK)
            url=f'http://127.0.0.1:{port}'
            # A pagina protegida redireciona visitantes nao autenticados.
            await teacher.goto(url+'/professor')
            assert '/admin' in teacher.url
            await teacher.locator('#username').fill('admin')
            await teacher.locator('#password').fill('Teste!Admin!2026!Segura')
            await teacher.get_by_role('button',name='Entrar na administração').click()
            await teacher.wait_for_url('**/professor')
            await teacher.get_by_role('button',name='Selecionar pasta e iniciar sala').click()
            await teacher.locator('#roomCode').wait_for()
            code=await teacher.locator('#roomCode').inner_text()
            pin=await teacher.locator('#roomPin').inner_text()
            await teacher.screenshot(path=str(ROOT/'preview_professor.png'),full_page=True)
            student=await browser.new_page(viewport={'width':1140,'height':900},accept_downloads=True)
            await student.goto(url)
            assert await student.locator('#selectFolder').count() == 0
            await student.goto(url+'/professor')
            assert '/admin' in student.url
            await student.goto(url)
            await student.locator('#roomInput').fill(code)
            await student.locator('#pinInput').fill(pin)
            await student.get_by_role('button',name='Acessar arquivos').click()
            await student.locator('.filename',has_text='material.txt').wait_for(timeout=15000)
            async with student.expect_download(timeout=20000) as download_info:
                await student.get_by_role('button',name='Baixar').click()
            download=await download_info.value
            path=await download.path()
            assert pathlib.Path(path).read_text()=='Conteudo da aula',pathlib.Path(path).read_bytes()
            await student.locator('#uploadFile').set_input_files({'name':'atividade.txt','mimeType':'text/plain','buffer':b'Entrega do aluno ETEC'})
            await student.locator('#uploadButton').click()
            await student.get_by_text('Arquivo enviado para a pasta do professor',exact=False).wait_for(timeout=20000)
            content=await teacher.evaluate('window.__files["atividade.txt"]')
            assert content=='Entrega do aluno ETEC',content
            await student.screenshot(path=str(ROOT/'preview_aluno.png'),full_page=True)
            assert await teacher.locator('#studentCount').inner_text()=='1'
            print('TESTE NO NAVEGADOR: PASSOU selecao da pasta, login, listagem, download e upload')
            print('ARQUIVOS GERADOS: preview_professor.png, preview_aluno.png')
            await browser.close()
    finally:
        proc.terminate();proc.wait(timeout=10)
if __name__=='__main__':asyncio.run(main())
