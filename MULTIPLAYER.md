# Multiplayer da cidade Spect

O multiplayer funciona somente dentro do Mundo 3D. As batalhas e os outros modos continuam locais.

## Iniciar no computador

1. Instale o Node.js se o comando `node` nao for reconhecido.
2. Abra `iniciar-spect.bat` ou execute `node server.js` nesta pasta.
3. Abra `http://localhost:3001` no navegador.
4. Entre no Mundo e use **JOGAR ONLINE**. O jogo cria um codigo de sala e um link para compartilhar.
5. Os outros jogadores abrem o mesmo link e entram no Mundo.

O jogador local aparece para os outros com nome e imagem escolhida. O servidor aceita ate 12 pessoas por sala. O link abre a sala, mas cada pessoa ainda precisa iniciar a cidade no proprio navegador.

## Para jogar pela internet

O servidor Node precisa ficar hospedado em um servico que aceite WebSocket e HTTPS/WSS. Hospedagem somente de arquivos estaticos, como o Netlify Drop, nao executa `server.js` e nao conecta as salas. Depois de hospedar o servidor, compartilhe o link publico da sala.
