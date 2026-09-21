OCR local
=========
O motor JavaScript, o worker e o núcleo WebAssembly estão hospedados neste diretório.
Apenas o arquivo de idioma português é obtido por HTTPS de tessdata.projectnaptha.com durante
a primeira leitura; o navegador pode mantê-lo em cache. Para operação totalmente offline,
hospede o arquivo por.traineddata.gz localmente e substitua langPath em assets/js/app.js.
