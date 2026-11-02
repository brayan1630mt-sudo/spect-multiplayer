# Multiplayer da cidade Spect

O multiplayer funciona somente dentro do Mundo 3D. As batalhas e os outros modos continuam locais.

## Iniciar no computador

1. Instale o Node.js se o comando `node` nao for reconhecido.
2. Abra `iniciar-spect.bat` ou execute `node server.js` nesta pasta.
3. Abra `http://localhost:3001` no navegador.
4. Entre no Mundo e use **JOGAR ONLINE**. O jogo cria um codigo de sala e um link para compartilhar.
5. Os outros jogadores abrem o mesmo link e entram no Mundo.

O jogador local aparece para os outros com nome e imagem escolhida. O servidor aceita ate 12 pessoas por sala. O link abre a sala, mas cada pessoa ainda precisa iniciar a cidade no proprio navegador.

## Desafios online e moedas

Perto de outro jogador, pressione **F** no computador ou toque em **DESAFIAR** no celular. O convite precisa ser aceito antes de a batalha iniciar. A batalha reutiliza o motor Spect; o servidor analisa as imagens e calcula o resultado oficial com uma semente comum. Ele so registra moedas depois de receber o mesmo resultado dos dois jogadores. O saldo fica associado a um cookie assinado pelo servidor, e o navegador nao escolhe nem envia o valor da recompensa.

Por padrao, uma vitoria concede 10 Moedas Azuis. Para ajustar, defina `SPECT_BLUE_COINS_PER_WIN` no ambiente do servidor. O arquivo de saldo e a chave de sessao ficam em `data/`; em hospedagem com disco persistente, defina `SPECT_DATA_DIR` para a pasta montada no disco. Use tambem `SPECT_SESSION_SECRET` como segredo estavel do servico se a pasta de dados nao for persistente. Sem disco persistente, uma nova instancia pode perder os saldos locais.

As imagens escolhidas sao enviadas como retratos PNG pequenos para os participantes da sala e para o servidor calcular os atributos da batalha. Elas nao sao gravadas no arquivo de moedas.

## Para jogar pela internet

O servidor Node precisa ficar hospedado em um servico que aceite WebSocket e HTTPS/WSS. Hospedagem somente de arquivos estaticos, como o Netlify Drop, nao executa `server.js` e nao conecta as salas. Depois de hospedar o servidor, compartilhe o link publico da sala.
