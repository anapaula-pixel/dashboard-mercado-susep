"""
Checagem (uma vez): a base do SES tem comissão separada dos outros custos de venda?

Lê três tabelas da BaseCompleta.zip:
  - Ses_campos.csv: nome de cada campo (nuitem, noitem, quadro do FIP)
  - SES_ValoresMovRamos.csv: valores por empresa x ramo x mês x campo
  - Ses_seguros.csv: despesa comercial total, que o painel usa hoje

Não altera nada no painel. Escreve o resultado no log e no resumo da execução do GitHub.

Uso:
    python scripts/checar_comissao.py                # baixa a base
    python scripts/checar_comissao.py --zip base.zip # usa um zip já baixado
"""
import argparse
import csv
import io
import os
import re
import sys
import tempfile
import zipfile
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from build_data import AKAD, baixar, num  # noqa: E402

ANO = "2025"
RAMOS = {"0378": "RC Profissional", "0654": "RCTR-C", "0655": "RC-DC", "0621": "Transporte Nacional", "0622": "Transporte Internacional", "0310": "D&O"}
PALAVRAS = re.compile(r"comiss|comerc|aquisi|agenc|corretag|pr[oó].?labore|custo", re.I)

saida = []


def out(txt=""):
    print(txt, flush=True)
    saida.append(txt)


def tabela(zf, nome):
    alvo = next((n for n in zf.namelist() if n.lower().replace(" ", "") == nome.lower()), None)
    if not alvo:
        out(f"**Tabela {nome} não encontrada no zip.**")
        return None, None
    raw = zf.open(alvo)
    texto = io.TextIOWrapper(raw, encoding="latin-1", newline="")
    leitor = csv.reader(texto, delimiter=";")
    cab = [c.strip().lower() for c in next(leitor)]
    return cab, leitor


def col(cab, *nomes):
    for n in nomes:
        if n in cab:
            return cab.index(n)
    raise KeyError(f"coluna {nomes} não encontrada em {cab}")


def mi(v):
    return f"R$ {v / 1e6:,.1f} mi".replace(",", "X").replace(".", ",").replace("X", ".")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip")
    a = ap.parse_args()
    caminho = a.zip
    if not caminho:
        caminho = os.path.join(tempfile.gettempdir(), "BaseCompleta.zip")
        baixar(caminho)
    zf = zipfile.ZipFile(caminho)

    out("# Checagem da comissão no SES")
    out(f"Tabelas no zip: {len(zf.namelist())}")
    out("")

    # 1) campos
    cab, rows = tabela(zf, "ses_campos.csv")
    campos = {}
    if cab:
        out(f"## Campos (Ses_campos.csv), colunas: {', '.join(cab)}")
        i_n, i_no = col(cab, "nuitem"), col(cab, "noitem")
        i_q = cab.index("nuquad") if "nuquad" in cab else None
        i_m = cab.index("mercado") if "mercado" in cab else None
        i_fim = cab.index("fimvigencia") if "fimvigencia" in cab else None
        out("")
        out("| nuitem | nome | quadro | mercado | fim vigência |")
        out("|---|---|---|---|---|")
        for r in rows:
            if len(r) <= max(i_n, i_no):
                continue
            nome = r[i_no].strip()
            campos[r[i_n].strip()] = nome
            if PALAVRAS.search(nome):
                out(f"| {r[i_n].strip()} | {nome} | {r[i_q].strip() if i_q is not None else ''} | {r[i_m].strip() if i_m is not None else ''} | {r[i_fim].strip() if i_fim is not None else ''} |")
        out("")

    # 2) valores por campo: Akad e mercado, ramos principais, no ano
    cab, rows = tabela(zf, "ses_valoresmovramos.csv")
    akad = defaultdict(float)
    merc = defaultdict(float)
    cias = defaultdict(set)
    todos_ak = defaultdict(float)
    if cab:
        out(f"## Valores (SES_ValoresMovRamos.csv), colunas: {', '.join(cab)}")
        i_e, i_m, i_c, i_r, i_v = col(cab, "coenti"), col(cab, "damesano"), col(cab, "cmpid"), col(cab, "ramcodigo"), col(cab, "valor")
        n = 0
        for r in rows:
            if len(r) <= max(i_e, i_m, i_c, i_r, i_v):
                continue
            if not r[i_m].strip().startswith(ANO):
                continue
            ramo = r[i_r].strip().zfill(4)
            if ramo not in RAMOS:
                continue
            cmp = r[i_c].strip()
            if ramo == "0378" and r[i_e].strip() == AKAD:
                todos_ak[cmp] += num(r[i_v])
            if not PALAVRAS.search(campos.get(cmp, "")):
                continue
            v = num(r[i_v])
            merc[(ramo, cmp)] += v
            if v:
                cias[(ramo, cmp)].add(r[i_e].strip())
            if r[i_e].strip() == AKAD:
                akad[(ramo, cmp)] += v
            n += 1
        out(f"Linhas lidas com campos de custo de venda em {ANO}: {n}")
        out("")

    # 2b) raio-x da tabela de valores: anos, quadros, ramos e linhas da Akad
    cab, rows = tabela(zf, "ses_valoresmovramos.csv")
    if cab:
        i_e, i_m, i_c, i_r, i_q = col(cab, "coenti"), col(cab, "damesano"), col(cab, "cmpid"), col(cab, "ramcodigo"), col(cab, "quadro")
        anos, quadros, ramos_vistos, exemplos, ak_anos = defaultdict(int), defaultdict(int), defaultdict(int), [], defaultdict(int)
        for r in rows:
            if len(r) <= max(i_e, i_m, i_c, i_r, i_q):
                continue
            anos[r[i_m].strip()[:4]] += 1
            quadros[r[i_q].strip()] += 1
            ramos_vistos[r[i_r].strip()] += 1
            if r[i_e].strip() == AKAD:
                ak_anos[r[i_m].strip()[:4]] += 1
            if len(exemplos) < 12 and r[i_m].strip()[:4] >= "2024":
                exemplos.append(" | ".join(x.strip() for x in r))
        out("## Raio-x de SES_ValoresMovRamos")
        out("Linhas por ano: " + ", ".join(f"{k}: {v}" for k, v in sorted(anos.items())))
        out("Linhas da Akad por ano: " + (", ".join(f"{k}: {v}" for k, v in sorted(ak_anos.items())) or "nenhuma"))
        out("Quadros: " + ", ".join(f"{k}: {v}" for k, v in sorted(quadros.items(), key=lambda kv: -kv[1])[:15]))
        out("Ramos (amostra): " + ", ".join(f"{k}: {v}" for k, v in sorted(ramos_vistos.items(), key=lambda kv: -kv[1])[:25]))
        out("Exemplos de linhas recentes:")
        for e in exemplos:
            out("    " + e)
        out("")

    # 3) despesa comercial total (o que o painel usa hoje)
    cab, rows = tabela(zf, "ses_seguros.csv")
    dc_a, dc_m, pg_a, pg_m = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)
    if cab:
        i_m, i_e, i_r = col(cab, "damesano"), col(cab, "coenti"), col(cab, "coramo")
        i_dc, i_pg = col(cab, "desp_com", "despesa_comercial"), col(cab, "premio_ganho")
        for r in rows:
            if len(r) <= max(i_m, i_e, i_r, i_dc, i_pg) or not r[i_m].strip().startswith(ANO):
                continue
            ramo = r[i_r].strip().zfill(4)
            if ramo not in RAMOS:
                continue
            dc_m[ramo] += num(r[i_dc]); pg_m[ramo] += num(r[i_pg])
            if r[i_e].strip() == AKAD:
                dc_a[ramo] += num(r[i_dc]); pg_a[ramo] += num(r[i_pg])

    # 4) comparação por ramo
    out(f"## Comparação por ramo, ano {ANO}")
    out("Despesa comercial (Ses_seguros) contra cada campo de custo de venda (SES_ValoresMovRamos). % = sobre o prêmio ganho.")
    for ramo, nome in RAMOS.items():
        out("")
        out(f"### {nome} ({ramo})")
        pa, pm = pg_a[ramo], pg_m[ramo]
        pc = lambda v, p: f"{v / p * 100:.1f}%" if p else "–"
        out(f"Prêmio ganho: Akad {mi(pa)} · mercado {mi(pm)}")
        out(f"**Despesa comercial (hoje): Akad {mi(dc_a[ramo])} ({pc(dc_a[ramo], pa)}) · mercado {mi(dc_m[ramo])} ({pc(dc_m[ramo], pm)})**")
        out("")
        out("| campo | nome | Akad | % PG Akad | mercado | % PG mercado | seguradoras com valor |")
        out("|---|---|---|---|---|---|---|")
        for (r, cmp), v in sorted(merc.items(), key=lambda kv: -abs(kv[1])):
            if r != ramo:
                continue
            va = akad.get((r, cmp), 0.0)
            out(f"| {cmp} | {campos.get(cmp, '?')} | {mi(va)} | {pc(va, pa)} | {mi(v)} | {pc(v, pm)} | {len(cias[(r, cmp)])} |")

    out("")
    out(f"## Todos os campos da Akad em RC Profissional, {ANO} (para achar campos com outro nome)")
    out("| campo | nome | valor |")
    out("|---|---|---|")
    for cmp, v in sorted(todos_ak.items(), key=lambda kv: -abs(kv[1]))[:60]:
        out(f"| {cmp} | {campos.get(cmp, '?')} | {mi(v)} |")

    resumo = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumo:
        with open(resumo, "a", encoding="utf-8") as f:
            f.write("\n".join(saida) + "\n")


if __name__ == "__main__":
    main()
