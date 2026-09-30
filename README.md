# Tomatudo

Timer Pomodoro em **HTML + CSS + JavaScript puros** — sem frameworks, sem bundler, sem dependências de build — com um tomate pixel-art que **murcha e derrete enquanto você foca** e **reidrata nas pausas**. Quanto mais cansado, mais ele amolece: casca perde o brilho, os gomos somem, o cálice murcha e ele vai escorrendo até virar poça.

É a mesma mecânica de energia do [Pomodemônio](https://github.com/danhpaiva/pomodoro-diabrete-html-css-js) (que por sua vez porta o [Pomodoro-Tamagotchi original em Python/Pygame](https://github.com/danhpaiva/pomodoro-diabrete)) — só troca a metáfora visual de "vira demônio" para "derrete sob pressão".

---

## Rodando localmente

Não há build step. Basta servir os arquivos estáticos:

```bash
python -m http.server 8080
```

E abrir `http://localhost:8080`.

## Estrutura

```
index.html      # markup + painel (timer, energia, ciclos, botões)
style.css       # tema escuro, cores de acento por fase (foco/pausa)
js/pet.js       # maquina de estados pura (ciclo foco/pausa, energia, humor) — identica ao Pomodemônio
js/app.js       # desenho do tomate em Canvas 2D + loop principal + UI
```

## Estágios do tomate

| Energia | Estado |
|---|---|
| 100–80% | viçoso — casca lisa e brilhante, gomos visíveis |
| 80–55% | suando — vapor leve, ainda firme |
| 55–25% | murchando — perde o brilho, gomos somem, corpo afunda |
| 25–0% | escorrendo — pinga pela base até virar poça, cálice murcho |

## Controles

| Ação | Como |
|---|---|
| Iniciar / pausar / avançar de fase | clique no botão principal, clique no tomate, `Espaço` ou `Enter` |
| Pular fase atual | botão "pular" ou `S` |
| Reiniciar sessão | botão "reiniciar" ou `R` |

## Deploy

Publicado automaticamente no GitHub Pages via GitHub Actions a cada push em `main` — veja [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml). O workflow roda um job de **CI** (validação) antes de liberar o job de **CD** (deploy); deploy só acontece se a validação passar.
