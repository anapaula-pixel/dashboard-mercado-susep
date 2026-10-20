"""
Gera os dados do Dashboard de Mercado (Akad) a partir da base pública do SES/SUSEP.

Fonte: https://www2.susep.gov.br/menuestatistica/SES/principal.aspx
Arquivo: BaseCompleta.zip (atualizado semanalmente pela SUSEP)

Saída: docs/data/ses.json (formato compacto, lido pelo dashboard)

Uso:
    python scripts/build_data.py                # baixa a base e gera o JSON
    python scripts/build_data.py --zip base.zip # usa um zip já baixado
"""
import argparse
import csv
import io
import json
import os
import sys
import tempfile
import time
import urllib.request
import zipfile
from datetime import datetime, timezone

ZIP_URL = "https://www2.susep.gov.br/download/estatisticas/BaseCompleta.zip"
AKAD = "02798"
DESDE = "201901"

# Ramos acompanhados (definidos com o time de produto)
RAMOS = {
    "0378": "R.C. Profissional",
    "0310": "R.C. Administradores e Diretores (D&O)",
    "0351": "R.C. Geral",
    "0118": "Compreensivo Empresarial",
    "0196": "Riscos Nomeados e Operacionais",
    "0171": "Riscos Diversos",
    "0167": "Riscos de Engenharia",
    "0621": "Transporte Nacional",
    "0622": "Transporte Internacional",
    "0654": "RCTR-C",
    "0655": "RC-DC",
    "0638": "RCTF-C (ferroviário)",
    "0632": "RCTR-VI-C (viagem internacional)",
    "0652": "RCTA-C (aéreo)",
    "0656": "RCA-C (aquaviário)",
    "0659": "RC-V",
    "0775": "Garantia Segurado - Setor Público",
    "0776": "Garantia Segurado - Setor Privado",
    "1457": "DPEM",
    "0746": "Fiança Locatícia",
    "0977": "Prestamista (coletivo)",
    "1377": "Prestamista (individual)",
}

# Linhas de produto da Akad (agrupam os ramos)
LINHAS = [
    {"id": "rcpro", "nome": "RC Profissional", "ramos": ["0378"]},
    {"id": "do", "nome": "RC Executivos (D&O)", "ramos": ["0310"]},
    {"id": "rcg", "nome": "RC Geral", "ramos": ["0351"]},
    {"id": "emp", "nome": "Empresarial", "ramos": ["0118"]},
    {"id": "rno", "nome": "Riscos Nomeados e Operacionais", "ramos": ["0196"]},
    {"id": "equip", "nome": "Equipamentos", "ramos": ["0171"]},
    {"id": "eng", "nome": "Engenharia", "ramos": ["0167"]},
    {"id": "transp", "nome": "Transporte (embarcador)", "ramos": ["0621", "0622"]},
    {"id": "rctr", "nome": "RC Transportador", "ramos": ["0654", "0655", "0638", "0632", "0652", "0656"]},
    {"id": "rcv", "nome": "RC-V", "ramos": ["0659"]},
    {"id": "gar", "nome": "Garantia", "ramos": ["0775", "0776"]},
    {"id": "dpem", "nome": "DPEM", "ramos": ["1457"]},
    {"id": "fianca", "nome": "Fiança Locatícia", "ramos": ["0746"]},
    {"id": "prest", "nome": "Prestamista", "ramos": ["0977", "1377"]},
]

UFS = "AC,AL,AM,AP,BA,CE,DF,ES,GO,MA,MG,MS,MT,PA,PB,PE,PI,PR,RJ,RN,RO,RR,RS,SC,SE,SP,TO".split(",")


def num(s):
    s = (s or "").strip()
    if not s:
        return 0.0
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


def mil(v):
    """R$ -> R$ mil com 1 casa decimal (reduz o tamanho do arquivo)."""
    return round(v / 1000, 1)


def baixar(destino):
    print(f"Baixando {ZIP_URL} ...", flush=True)
    req = urllib.request.Request(ZIP_URL, headers={"User-Agent": "Mozilla/5.0 (dashboard-mercado-akad)"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r, open(destino, "wb") as f:
        total = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
    print(f"  {total/1e6:.0f} MB em {time.time()-t0:.0f}s", flush=True)


def linhas_csv(zf, nome):
    alvo = next(n for n in zf.namelist() if n.lower() == nome.lower())
    with zf.open(alvo) as raw:
        texto = io.TextIOWrapper(raw, encoding="latin-1", newline="")
        leitor = csv.reader(texto, delimiter=";")
        next(leitor)  # cabeçalho
        for linha in leitor:
            yield linha


def processar(zip_path):
    zf = zipfile.ZipFile(zip_path)

    # 1) Prêmios e sinistros por seguradora x ramo x mês
    t0 = time.time()
    seg = {}
    for c in linhas_csv(zf, "Ses_seguros.csv"):
        if len(c) < 16:
            continue
        mes = c[0].strip()
        if mes < DESDE:
            continue
        ramo = c[3].strip()
        if ramo not in RAMOS:
            continue
        k = (mes, c[1].strip(), ramo)
        a = seg.setdefault(k, [0.0] * 6)
        a[0] += num(c[11])  # prêmio emitido
        a[1] += num(c[7])   # prêmio ganho
        a[2] += num(c[14])  # sinistro ocorrido
        a[3] += num(c[10])  # despesa comercial
        a[4] += num(c[13])  # despesa com resseguro
        a[5] += num(c[15])  # receita com resseguro
    print(f"Ses_seguros: {len(seg)} combinações ({time.time()-t0:.0f}s)", flush=True)

    # 2) Prêmios e sinistros por UF
    t0 = time.time()
    ufm = {}   # (mes, ramo, uf) -> [prem mercado, prem akad, sin mercado, sin akad]
    ufa = {}   # (ano, ramo, uf, cia) -> prêmio
    for c in linhas_csv(zf, "SES_UF2.csv"):
        if len(c) < 7:
            continue
        mes = c[1].strip()
        if mes < DESDE:
            continue
        ramo = c[2].strip()
        if ramo not in RAMOS:
            continue
        uf = c[3].strip()
        if uf not in UFS:
            continue
        cia = c[0].strip()
        p, s = num(c[4]), num(c[6])
        x = ufm.setdefault((mes, ramo, uf), [0.0] * 4)
        x[0] += p
        x[2] += s
        if cia == AKAD:
            x[1] += p
            x[3] += s
        k2 = (mes[:4], ramo, uf, cia)
        ufa[k2] = ufa.get(k2, 0.0) + p
    print(f"SES_UF2: {len(ufm)} combinações ({time.time()-t0:.0f}s)", flush=True)

    # 3) Nomes e grupos econômicos
    nomes = {}
    for c in linhas_csv(zf, "Ses_cias.csv"):
        if c and c[0].strip():
            nomes[c[0].strip()] = (c[1] if len(c) > 1 else "").strip()
    grupos = {}
    for c in linhas_csv(zf, "Ses_grupos_economicos.csv"):
        if len(c) < 5 or not c[1].strip():
            continue
        cod, mes = c[1].strip(), c[0].strip()
        if cod not in grupos or mes > grupos[cod][0]:
            grupos[cod] = (mes, c[4].strip())

    def grupo(cod):
        g = grupos.get(cod, (None, ""))[1]
        if not g or "OUTROS GRUPOS" in g.upper() or "INDEPENDENTE" in g.upper():
            return None
        return g

    # Índices compactos
    ramos = sorted(RAMOS)
    ri = {r: i for i, r in enumerate(ramos)}
    meses = sorted({k[0] for k in seg})
    mi = {m: i for i, m in enumerate(meses)}
    cias = sorted({k[1] for k in seg})
    ci = {c: i for i, c in enumerate(cias)}
    ui = {u: i for i, u in enumerate(UFS)}

    seg_rows = []
    for (m, c, r), a in seg.items():
        v = [mil(x) for x in a]
        if any(v):
            seg_rows.append([mi[m], ci[c], ri[r]] + v)

    ufm_rows = []
    for (m, r, u), a in ufm.items():
        if m not in mi:
            continue
        v = [mil(x) for x in a]
        if any(v):
            ufm_rows.append([mi[m], ri[r], ui[u]] + v)

    ufa_rows = []
    for (y, r, u, c), v in ufa.items():
        if abs(v) < 1000:
            continue
        if c not in ci:
            ci[c] = len(cias)
            cias.append(c)
        ufa_rows.append([int(y), ri[r], ui[u], ci[c], mil(v)])

    seg_rows.sort()
    ufm_rows.sort()
    ufa_rows.sort()

    return {
        "v": 1,
        "gerado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fonte": "SUSEP, Sistema de Estatísticas (SES), BaseCompleta.zip",
        "unidade": "R$ mil",
        "akad": AKAD,
        "meses": meses,
        "ramos": [[r, RAMOS[r]] for r in ramos],
        "linhas": LINHAS,
        "ufs": UFS,
        "cias": [[c, nomes.get(c, c), grupo(c)] for c in cias],
        "cols": {
            "seg": ["mes", "cia", "ramo", "premio_emitido", "premio_ganho", "sinistro_ocorrido",
                    "despesa_comercial", "despesa_resseguro", "receita_resseguro"],
            "ufm": ["mes", "ramo", "uf", "premio_mercado", "premio_akad", "sinistro_mercado", "sinistro_akad"],
            "ufa": ["ano", "ramo", "uf", "cia", "premio"],
        },
        "seg": seg_rows,
        "ufm": ufm_rows,
        "ufa": ufa_rows,
    }


def checar(d):
    """Confere um valor conhecido: RC Profissional Akad jan/24 a ago/26 = R$ 482,8 mi."""
    mi = {m: i for i, m in enumerate(d["meses"])}
    ci = {c[0]: i for i, c in enumerate(d["cias"])}
    ri = {r[0]: i for i, r in enumerate(d["ramos"])}
    if "202608" not in mi:
        return
    tot = sum(r[3] for r in d["seg"]
              if r[1] == ci[AKAD] and r[2] == ri["0378"] and mi["202401"] <= r[0] <= mi["202608"])
    print(f"Checagem RC Profissional Akad 2024-01..2026-08: R$ {tot/1000:.1f} mi (esperado ~482,8)")
    if abs(tot - 482754.6) > 5000:
        print("  ATENÇÃO: valor diferente do esperado (a SUSEP pode ter recarregado dados)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", help="caminho de um BaseCompleta.zip já baixado")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "docs", "data", "ses.json"))
    args = ap.parse_args()

    zip_path = args.zip
    tmp = None
    if not zip_path:
        tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp.close()
        zip_path = tmp.name
        baixar(zip_path)

    dados = processar(zip_path)
    checar(dados)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Gravado {args.out} ({os.path.getsize(args.out)/1e6:.1f} MB), último mês {dados['meses'][-1]}")

    if tmp:
        os.unlink(zip_path)


if __name__ == "__main__":
    sys.exit(main())
