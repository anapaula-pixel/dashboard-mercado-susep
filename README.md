# Dashboard de Mercado Akad (SUSEP)

Dashboard com dados de mercado dos ramos em que a Akad Seguros atua, a partir do
Sistema de Estatísticas da SUSEP (SES).

- **Dashboard:** publicado pelo GitHub Pages a partir da pasta `docs/`.
- **Atualização:** o workflow `Atualizar dados SUSEP` roda toda segunda-feira, baixa a
  base completa do SES, processa os ramos acompanhados e salva `docs/data/ses.json`.
  O commit só acontece quando os números mudam. Também dá para rodar manualmente na aba
  Actions ("Run workflow").
- **Ramos e linhas de produto:** definidos em `scripts/build_data.py` (`RAMOS` e `LINHAS`).

Valores em R$ mil. Fonte: SUSEP, SES, BaseCompleta.zip.
