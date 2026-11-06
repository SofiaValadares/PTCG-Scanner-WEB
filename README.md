# PTCG Scanner — site

Interface web da leitura de cartas. Na demonstração local a página e o modelo sobem juntos: detector `obb-v6`, ROI `ocr-roi-v3` e o catálogo.

Licença: [CC BY-NC 4.0](LICENSE).

## Rodar

Um processo só, neste PC:

```powershell
cd "C:\Users\Pichau\Documents\Repositorios\Web-PTCG-Scanner"
.\scripts\run_local.ps1
```

Abra [http://127.0.0.1:5500](http://127.0.0.1:5500). A primeira vez espera o detector, o OCR e o catálogo. O status fica **Pronto**. Não é preciso subir a API em outra porta.

## Túnel

Edite `js/config.js`:

```js
tunnelUrl: "https://SEU-TUNEL.trycloudflare.com",
localUrl: "http://127.0.0.1:8000",
```

Ou no site: **API / túnel**. O valor fica no `localStorage`.

Fluxo: tenta `tunnelUrl/health` → se falhar, mostra o aviso e tenta `localUrl`. Sem os dois, pede para configurar.

No celular em **outra internet** o `127.0.0.1` não é o seu PC: o túnel da API precisa estar no ar, e o site também tem de ser acessível (mesmo túnel, GitHub Pages, ou o site aberto no PC).

Cada carta no resultado mostra o **recorte** ao lado da arte oficial da [TCGdex](https://tcgdex.dev/) (busca por nome + número + set).

## Layout

```
index.html
css/styles.css
js/config.js      ← URL do túnel
js/api.js
js/app.js
assets/demo/      fotos de demonstração
```
