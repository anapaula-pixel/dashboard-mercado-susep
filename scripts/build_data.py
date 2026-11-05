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
import urllib.error
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

# Ramos exibidos no painel: um por código SUSEP, sem agrupar (desc: o que o seguro cobre, em uma linha)
LINHAS = [
    {"id": "rcpro", "nome": "RC Profissional", "ramos": ["0378"], "desc": "Erros e omissões de profissionais e empresas na prestação de serviços."},
    {"id": "do", "nome": "RC Executivos (D&O)", "ramos": ["0310"], "desc": "Protege diretores e administradores contra reclamações por decisões de gestão."},
    {"id": "rcg", "nome": "RC Geral", "ramos": ["0351"], "desc": "Danos causados a terceiros pelas atividades, produtos ou instalações da empresa."},
    {"id": "emp", "nome": "Empresarial", "ramos": ["0118"], "desc": "Patrimônio da empresa, como prédio e conteúdo, contra incêndio, roubo e outros eventos."},
    {"id": "rno", "nome": "Riscos Nomeados e Operacionais", "ramos": ["0196"], "desc": "Grandes riscos patrimoniais e industriais, com coberturas amplas."},
    {"id": "equip", "nome": "Equipamentos", "ramos": ["0171"], "desc": "Máquinas e equipamentos contra danos, quebra e roubo."},
    {"id": "eng", "nome": "Engenharia", "ramos": ["0167"], "desc": "Obras civis e montagem de instalações durante a execução."},
    {"id": "transpnac", "nome": "Transporte Nacional", "ramos": ["0621"], "desc": "Mercadorias do dono da carga em viagens dentro do Brasil."},
    {"id": "transpint", "nome": "Transporte Internacional", "ramos": ["0622"], "desc": "Mercadorias do dono da carga em importação e exportação."},
    {"id": "rctrc", "nome": "RCTR-C", "ramos": ["0654"], "desc": "Obrigatório para o transportador rodoviário: danos à carga em acidente com o veículo."},
    {"id": "rcdc", "nome": "RC-DC", "ramos": ["0655"], "desc": "Para o transportador: carga perdida por roubo, furto ou desaparecimento."},
    {"id": "rcv", "nome": "RC-V", "ramos": ["0659"], "desc": "Obrigatório para o transportador de cargas: danos a terceiros causados pelo veículo."},
    {"id": "rctrvi", "nome": "RCTR-VI-C", "ramos": ["0632"], "desc": "Transportador rodoviário em viagem internacional: danos à carga."},
    {"id": "rctfc", "nome": "RCTF-C", "ramos": ["0638"], "desc": "Transportador ferroviário: danos à carga transportada."},
    {"id": "rctac", "nome": "RCTA-C", "ramos": ["0652"], "desc": "Transportador aéreo: danos à carga transportada."},
    {"id": "rcac", "nome": "RCA-C", "ramos": ["0656"], "desc": "Transportador aquaviário: danos à carga transportada."},
    {"id": "garpub", "nome": "Garantia Setor Público", "ramos": ["0775"], "desc": "Garante que a empresa cumpra contratos e licitações com o governo."},
    {"id": "garpriv", "nome": "Garantia Setor Privado", "ramos": ["0776"], "desc": "Garante obrigações em contratos entre empresas privadas."},
    {"id": "dpem", "nome": "DPEM", "ramos": ["1457"], "desc": "Seguro obrigatório de embarcações: danos pessoais causados a pessoas."},
    {"id": "fianca", "nome": "Fiança Locatícia", "ramos": ["0746"], "desc": "Substitui o fiador no aluguel e garante o pagamento ao proprietário."},
    {"id": "prestcol", "nome": "Prestamista Coletivo", "ramos": ["0977"], "desc": "Quita a dívida de um financiamento em caso de morte ou invalidez, contratado em grupo."},
    {"id": "prestind", "nome": "Prestamista Individual", "ramos": ["1377"], "desc": "Quita a dívida de um financiamento em caso de morte ou invalidez, contratado individualmente."},
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


def baixar(destino, tentativas=3, espera=300):
    """Baixa a base da SUSEP. O servidor às vezes fica fora do ar ou lento,
    então tenta de novo algumas vezes (com intervalo) antes de desistir."""
    for n in range(1, tentativas + 1):
        try:
            _baixar_uma_vez(destino)
            return
        except (OSError, urllib.error.URLError) as e:
            print(f"  Tentativa {n} de {tentativas} falhou: {e}", flush=True)
            if n == tentativas:
                raise
            print(f"  Nova tentativa em {espera // 60} min ...", flush=True)
            time.sleep(espera)


def _baixar_uma_vez(destino):
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

    # 1b) Abertura do custo de comercialização (mapas de custos de aquisição, quadro 8 do FIP)
    #     12479 = custos ligados à vigência do risco (na prática, comissão de corretagem e agenciamento)
    #     12486 = outros custos de aquisição (pró-labore, bônus, campanhas etc.)
    #     A soma dos dois bate com a despesa comercial de Ses_seguros. Só complementa linhas que já existem.
    # 1c) Sinistro incorrido no padrão da Akad (quadro 6 do FIP), lido no mesmo arquivo:
    #     indenizações avisadas (12182, já líquidas de cosseguro) + despesas com sinistros avisadas (12196)
    #     - salvados e ressarcidos avisados (12207). Bruto de resseguro, sem IBNR e sem IBNER.
    t0 = time.time()
    CAMPOS_AQ = {"12479": 0, "12486": 1}
    CAMPOS_SIN = {"12182": 1.0, "12196": 1.0, "12207": -1.0}
    aq = {}
    inc = {}
    try:
        alvo = next(n for n in zf.namelist() if n.lower().replace(" ", "") == "ses_valoresmovramos.csv")
        with zf.open(alvo) as raw:
            leitor = csv.reader(io.TextIOWrapper(raw, encoding="latin-1", newline=""), delimiter=";")
            cab = [x.strip().lower() for x in next(leitor)]
            i_e, i_m, i_c, i_g, i_r, i_v = (cab.index(n) for n in ("coenti", "damesano", "cmpid", "gracodigo", "ramcodigo", "valor"))
            n_max = max(i_e, i_m, i_c, i_g, i_r, i_v)
            for c in leitor:
                if len(c) <= n_max:
                    continue
                cmp = c[i_c].strip()
                j = CAMPOS_AQ.get(cmp)
                sinal = CAMPOS_SIN.get(cmp)
                if j is None and sinal is None:
                    continue
                mes = c[i_m].strip()
                if mes < DESDE:
                    continue
                ramo = c[i_g].strip().zfill(2) + c[i_r].strip().zfill(2)
                if ramo not in RAMOS:
                    continue
                k = (mes, c[i_e].strip(), ramo)
                if sinal is not None:
                    inc[k] = inc.get(k, 0.0) + sinal * num(c[i_v])
                    continue
                if k not in seg:
                    continue
                aq.setdefault(k, [0.0, 0.0])[j] += num(c[i_v])
    except (StopIteration, ValueError) as e:
        print(f"  Abertura de comissão indisponível nesta base ({e}); segue sem ela.", flush=True)
    print(f"Custos de aquisição: {len(aq)} combinações; sinistro incorrido: {len(inc)} ({time.time()-t0:.0f}s)", flush=True)
    # seguradora com sinistro incorrido no mês mas sem linha de prêmio: entra com prêmio zero (só meses que já existem)
    meses_seg = {k[0] for k in seg}
    for k in inc:
        if k not in seg and k[0] in meses_seg:
            seg[k] = [0.0] * 6

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
        if any(v) or inc.get((m, c, r)):
            q = aq.get((m, c, r))
            # comissão e outros custos de aquisição (null quando a SUSEP não abriu) e sinistro incorrido no fim da linha
            seg_rows.append([mi[m], ci[c], ri[r]] + v + ([mil(q[0]), mil(q[1])] if q else [None, None]) + [mil(inc.get((m, c, r), 0.0))])

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
                    "despesa_comercial", "despesa_resseguro", "receita_resseguro",
                    "comissao", "outros_custos_aquisicao", "sinistro_incorrido"],
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
    # abertura da comissão: comissão + outros custos deve bater com a despesa comercial
    lin = [r for r in d["seg"] if r[1] == ci[AKAD] and r[2] == ri["0378"] and len(r) > 10 and r[9] is not None]
    if lin:
        dc, cm, ou = sum(r[6] for r in lin), sum(r[9] for r in lin), sum(r[10] for r in lin)
        print(f"Checagem comissão RC Profissional Akad: comissão {cm/1000:.1f} mi + outros {ou/1000:.1f} mi = {(cm+ou)/1000:.1f} mi; despesa comercial {dc/1000:.1f} mi")


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
